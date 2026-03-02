const express = require('express');
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const { getWilayaById, getWilayaName } = require('../utils/wilaya-mapper');
const DeliveryDeskMapper = require('../utils/delivery-desk-mapper');
const whatsappService = require('../services/whatsapp');
const sseService = require('../services/sse-service');
const router = express.Router();

const prisma = new PrismaClient();

const createOrderSchema = z.object({
  customerName: z.string().min(1, 'Customer name is required'),
  customerPhone: z.string().min(10, 'Valid phone number is required'),
  customerEmail: z.string().email().optional(),
  customerInstagram: z.string().optional(),
  deliveryType: z.enum(['HOME_DELIVERY', 'PICKUP']),
  deliveryAddress: z.string().optional(),
  wilayaId: z.number().min(1, 'Wilaya is required'),
  communeId: z.string().optional(), // Added communeId
  communeName: z.string().optional(), // Added communeName
  wilayaName: z.string().optional(), // Added wilayaName
  deliveryDeskId: z.string().optional(),
  deliveryDeskName: z.string().optional(),
  deliveryFee: z.union([z.number().min(0, 'Delivery fee must be non-negative'), z.undefined()]).optional(),
  notes: z.string().transform(val => val ? `Client: ${val}` : val).optional(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().min(1),
    sizeId: z.string().optional(),
    size: z.string().optional() // Size string as fallback
  })).min(1, 'At least one item is required')
}).refine((data) => {
  // For PICKUP orders, deliveryDeskId should be provided and not empty
  if (data.deliveryType === 'PICKUP' && (!data.deliveryDeskId || data.deliveryDeskId.trim() === '')) {
    return false;
  }
  return true;
}, {
  message: "Delivery desk ID is required for pickup orders",
  path: ["deliveryDeskId"]
});

// Create new order
router.post('/', async (req, res) => {
  try {
    console.log('🔍 Received order data:', req.body);

    let orderData;
    try {
      orderData = createOrderSchema.parse(req.body);
    } catch (validationError) {
      console.error('❌ Validation error:', validationError.errors);
      console.error('❌ Received data:', req.body);
      return res.status(400).json({
        error: 'Invalid input data',
        details: validationError.errors,
        receivedData: req.body
      });
    }

    // Get wilaya information using the mapper utility
    const wilayaInfo = getWilayaById(orderData.wilayaId);
    if (!wilayaInfo) {
      return res.status(400).json({
        error: `Unsupported wilaya ID: ${orderData.wilayaId}`
      });
    }

    const cityName = wilayaInfo.name;

    // Find the city by name with fallback options
    let city = await prisma.city.findFirst({
      where: { name: cityName }
    });

    // If not found, try alternative name formats
    if (!city) {
      // Try with different case variations and alternative names
      city = await prisma.city.findFirst({
        where: {
          OR: [
            { name: { equals: cityName, mode: 'insensitive' } },
            { name: { contains: cityName, mode: 'insensitive' } },
            { nameAr: { contains: cityName, mode: 'insensitive' } },
            // Try with alternative names from the mapper
            ...wilayaInfo.alternatives.map(alt => ({
              name: { equals: alt, mode: 'insensitive' }
            })),
            ...wilayaInfo.alternatives.map(alt => ({
              nameAr: { contains: alt, mode: 'insensitive' }
            }))
          ]
        }
      });
    }

    if (!city) {
      console.log(`City not found for wilaya ID ${orderData.wilayaId} with name: ${cityName}. Creating city...`);

      // Create the city if it doesn't exist
      try {
        city = await prisma.city.create({
          data: {
            name: cityName,
            nameAr: wilayaInfo.nameAr,
            code: wilayaInfo.code,
            deliveryFee: 300, // Default delivery fee
            isActive: true
          }
        });
        console.log(`✅ Created new city: ${city.name} (${city.nameAr})`);
      } catch (createError) {
        console.error(`❌ Failed to create city ${cityName}:`, createError);
        console.error('Available cities in database:', await prisma.city.findMany({ select: { name: true, nameAr: true } }));
        return res.status(400).json({
          error: `City not found for wilaya: ${cityName}. Please contact support.`
        });
      }
    }

    // Generate order number - starting from 000100
    // Find the highest order number to ensure we always increment properly
    // This handles cases where orders were deleted
    const allOrders = await prisma.order.findMany({
      where: {
        orderNumber: {
          startsWith: 'ORD-'
        }
      },
      select: {
        orderNumber: true
      }
    });

    let nextOrderNum = 100; // Start from 100 (000100)
    if (allOrders.length > 0) {
      // Extract all order numbers and find the maximum
      const orderNumbers = allOrders
        .map(o => {
          const match = o.orderNumber.match(/ORD-(\d+)/);
          return match ? parseInt(match[1]) : 0;
        })
        .filter(n => n >= 100); // Only consider numbers >= 100
      
      if (orderNumbers.length > 0) {
        const maxOrderNum = Math.max(...orderNumbers);
        nextOrderNum = maxOrderNum >= 100 ? maxOrderNum + 1 : 100;
      }
    }
    const orderNumber = `ORD-${String(nextOrderNum).padStart(6, '0')}`;

    // Validate products and calculate totals
    let subtotal = 0;
    const orderItems = [];

    for (const item of orderData.items) {
      console.log(`🔍 Processing order item:`, {
        productId: item.productId,
        sizeId: item.sizeId,
        size: item.size,
        quantity: item.quantity
      });

      const product = await prisma.product.findUnique({
        where: { id: item.productId },
        include: { sizes: true }
      });

      if (!product || !product.isActive) {
        return res.status(400).json({
          error: `Product not found: ${item.productId}`
        });
      }

      console.log(`📦 Product found: ${product.name}`, {
        productId: product.id,
        hasSizes: product.sizes && product.sizes.length > 0,
        sizes: product.sizes?.map(s => ({ id: s.id, size: s.size })) || []
      });

      // Check stock
      let availableStock = product.stock;
      let sizeString = null;
      let foundSize = null;

      // If product has sizes, we need to find the correct size
      if (product.sizes && product.sizes.length > 0) {
        // Try to find size by ID first
        if (item.sizeId) {
          foundSize = product.sizes.find(s => s.id === item.sizeId);
        }

        // If sizeId not found or not provided, try to find by size string (exact match only)
        if (!foundSize && item.size) {
          // Only do exact match - no partial matching to avoid wrong size selection
          // (e.g., "XXXL" should not match "L" just because "L" is contained in "XXXL")
          foundSize = product.sizes.find(s => 
            s.size.toLowerCase().trim() === item.size.toLowerCase().trim()
          );
        }

        // If we found a size (either by ID or string), use it
        if (foundSize) {
          availableStock = foundSize.stock;
          sizeString = foundSize.size;
          // Update sizeId to the correct one in case it was found by string
          item.sizeId = foundSize.id;
        } else {
          // Size was specified but not found - allow it anyway (custom order)
          // Use the client's requested size string as-is
          if (item.size) {
            sizeString = item.size;
            // Set sizeId to null since this size doesn't exist in the backend
            item.sizeId = null;
            // Use product stock as fallback (since we don't have size-specific stock)
            availableStock = product.stock;
            console.log(`ℹ️ Size "${item.size}" not found in backend for product: ${product.name}, using client's requested size as-is`);
          } else if (item.sizeId) {
            // If only sizeId was provided but not found, we can't use it
            // This shouldn't happen in normal flow, but handle it gracefully
            sizeString = null;
            item.sizeId = null;
            availableStock = product.stock;
            console.warn(`⚠️ SizeId "${item.sizeId}" not found for product: ${product.name}, size will be null`);
          } else {
            // No size specified - this is fine for products that might not require sizes
            sizeString = null;
            item.sizeId = null;
            availableStock = product.stock;
          }
        }
      } else {
        // Product has no sizes (accessories) - sizeId and size should be null/undefined
        if (item.sizeId || item.size) {
          console.warn(`Product ${product.name} has no sizes, but size was specified: ${item.sizeId || item.size}`);
        }
        // For products without sizes, we use the product stock directly
        sizeString = null;
        item.sizeId = null;
      }

      /* 
      // DISABLED STOCK CHECK - Custom Requirement
      // Allow orders even if stock is insufficient (Backorders)
      if (availableStock < item.quantity) {
        return res.status(400).json({
          error: `Insufficient stock for product: ${product.name}`
        });
      }
      */

      const itemTotal = product.price * item.quantity;
      subtotal += itemTotal;

      orderItems.push({
        productId: item.productId,
        quantity: item.quantity,
        price: product.price,
        sizeId: item.sizeId,
        size: sizeString
      });
    }

    // Use delivery fee from frontend or calculate default
    const deliveryFee = (orderData.deliveryFee !== undefined && orderData.deliveryFee !== null) ? orderData.deliveryFee : (orderData.deliveryType === 'HOME_DELIVERY' ? 500 : 0);
    const total = subtotal + deliveryFee;

    console.log('🔍 Order creation debug:', {
      subtotal,
      deliveryFee,
      total,
      deliveryType: orderData.deliveryType,
      frontendDeliveryFee: orderData.deliveryFee
    });

    // Handle delivery desk for pickup orders
    let deliveryDeskId = null;
    if (orderData.deliveryType === 'PICKUP') {
      // Use the mapper to find or create a delivery desk for this city
      const centerName = orderData.deliveryDeskName || `Yalidine Center - ${city.name}`;
      deliveryDeskId = await DeliveryDeskMapper.findOrCreateDeliveryDesk(
        city.id,
        orderData.deliveryDeskId, // Yalidine center ID
        centerName // Yalidine center name
      );

      if (deliveryDeskId) {
        console.log(`✅ Delivery desk resolved: ${deliveryDeskId}`);
      } else {
        console.log(`⚠️ Could not resolve delivery desk for city: ${city.name} (${city.id})`);
        // Order will be created without a delivery desk
      }
    }

    // Create order in transaction
    const order = await prisma.$transaction(async (tx) => {
      // Create the order
      const newOrder = await tx.order.create({
        data: {
          orderNumber,
          customerName: orderData.customerName,
          customerPhone: orderData.customerPhone,
          customerEmail: orderData.customerEmail,
          customerInstagram: orderData.customerInstagram,
          deliveryType: orderData.deliveryType,
          deliveryAddress: orderData.deliveryAddress,
          deliveryFee,
          subtotal,
          total,
          notes: orderData.notes,
          cityId: city.id,
          deliveryDeskId: deliveryDeskId,
          // deliveryDetails restored
          deliveryDetails: {
            wilayaId: String(orderData.wilayaId),
            wilayaName: orderData.wilayaName,
            communeId: orderData.communeId,
            communeName: orderData.communeName,
            centerId: orderData.deliveryDeskId,
            centerName: orderData.deliveryDeskName
          },
          items: {
            create: orderItems
          }
        },
        include: {
          items: {
            include: {
              product: true,
              productSize: true
            }
          },
          city: true,
          deliveryDesk: true
        }
      });

      // Stock is NOT decremented here - it will be decremented when scanning in the smart inventory sortie section

      return newOrder;
    });

    // Send SSE notification to all connected admin users
    try {
      const adminUsers = await prisma.user.findMany({
        where: { 
          role: { in: ['ADMIN', 'CONFIRMATRICE', 'AGENT_LIVRAISON', 'STOCK_MANAGER'] }
        }
      });

      console.log(`📢 Preparing SSE notification for new order: ${orderNumber}`);
      console.log(`👥 Found ${adminUsers.length} admin users to notify`);

      const sseNotification = {
        type: 'new_order',
        title: 'Nouvelle Commande',
        message: `Commande #${orderNumber} de ${orderData.customerName}. Total: ${total.toLocaleString()} DA`,
        orderId: order.id,
        orderNumber: orderNumber,
        customerName: orderData.customerName,
        total: total,
        url: `/admin/orders/${order.id}`,
        timestamp: new Date().toISOString()
      };

      // Broadcast to all admin users via SSE
      let notifiedCount = 0;
      const totalClients = sseService.getTotalClients();
      console.log(`📊 Broadcasting to ${adminUsers.length} admin users, ${totalClients} total SSE clients connected`);
      
      // Log all connected user IDs for debugging
      if (totalClients > 0) {
        console.log(`🔍 Debug: Checking SSE client connections...`);
        const connectedUserIds = sseService.getConnectedUserIds();
        connectedUserIds.forEach(connectedUserId => {
          const count = sseService.getUserClientCount(connectedUserId);
          console.log(`  - Connected user ID: ${connectedUserId} (${count} connection(s))`);
        });
      }
      
      adminUsers.forEach(user => {
        const userClientCount = sseService.getUserClientCount(user.id);
        console.log(`👤 User ${user.id} (${user.role}): ${userClientCount} active SSE connection(s)`);
        
        const sent = sseService.sendToUser(user.id, sseNotification);
        if (sent) {
          notifiedCount++;
          console.log(`✅ SSE notification sent to user: ${user.id} (${user.role})`);
        } else {
          console.log(`⚠️ No active SSE connection for user: ${user.id} (${user.role}) - user may not be connected`);
        }
      });

      console.log(`📨 SSE notification sent to ${notifiedCount}/${adminUsers.length} connected admin users for order: ${orderNumber}`);
      console.log(`🔌 Total SSE clients connected: ${totalClients}`);
      
      if (notifiedCount === 0 && totalClients > 0) {
        console.warn(`⚠️ WARNING: ${totalClients} SSE clients connected but none matched admin users!`);
      }
    } catch (sseError) {
      console.error('❌ Failed to send SSE notification:', sseError);
      console.error('Error details:', sseError.stack);
    }

    // Send push notification to Admin users (keep existing push notifications)
    try {
      const adminUsers = await prisma.user.findMany({
        where: { role: 'ADMIN' },
        include: { pushSubscriptions: true }
      });

      const notificationPayload = JSON.stringify({
        title: 'New Order Received',
        body: `Order #${orderNumber} received from ${orderData.customerName}. Total: ${total} DA`,
        url: `/admin/orders/${order.id}`, // Deep link to order
        data: {
          orderId: order.id
        }
      });

      const webpush = require('web-push');
      const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
      const privateVapidKey = process.env.VAPID_PRIVATE_KEY;

      if (publicVapidKey && privateVapidKey) {
        webpush.setVapidDetails(
          'mailto:admin@loudbrands.com',
          publicVapidKey,
          privateVapidKey
        );
      } else {
        console.warn('Skipping push notifications: VAPID keys not configured');
      }

      for (const user of adminUsers) {
        for (const sub of user.pushSubscriptions) {
          try {
            await webpush.sendNotification({
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth }
            }, notificationPayload);
          } catch (error) {
            console.error('Error sending notification to user', user.id, error);
            if (error.statusCode === 410) {
              // Subscription expired
              await prisma.pushSubscription.delete({ where: { id: sub.id } });
            }
          }
        }
      }
    } catch (notifyError) {
      console.error('Failed to send admin push notifications:', notifyError);
    }

    // Send WhatsApp notification to admin
    try {
      const whatsappResult = await whatsappService.sendOrderNotification(order);
      if (whatsappResult.success) {
        console.log(`WhatsApp notification sent successfully via ${whatsappResult.provider}`);
      } else {
        console.warn('WhatsApp notification failed:', whatsappResult.error);
      }
    } catch (whatsappError) {
      // Don't fail the order creation if WhatsApp fails
      console.error('Failed to send WhatsApp notification:', whatsappError);
    }

    res.status(201).json({
      message: 'Order created successfully',
      order
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid input data',
        details: error.errors
      });
    }

    console.error('Order creation error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Get all orders (for admin)
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, status, city } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status && status !== 'all') {
      where.callCenterStatus = status;
    }
    if (city && city !== 'all') {
      where.city = {
        name: city
      };
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            include: {
              product: {
                include: {
                  images: {
                    where: { isPrimary: true },
                    take: 1
                  }
                }
              }
            }
          },
          city: true,
          deliveryDesk: true
        }
      }),
      prisma.order.count({ where })
    ]);

    res.json({
      orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Get order by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              include: {
                images: {
                  where: { isPrimary: true },
                  take: 1
                }
              }
            },
            productSize: true
          }
        },
        city: true,
        deliveryDesk: true
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    console.error('Order fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

module.exports = router;