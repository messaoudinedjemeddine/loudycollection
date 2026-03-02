const express = require('express');
const { authenticateToken, requireAdmin, requireConfirmatrice, requireAgentLivraison, requireAnyRole } = require('../middleware/auth');
const prisma = require('../config/database');
const { z } = require('zod');
const { getWilayaById } = require('../utils/wilaya-mapper');
const yalidineService = require('../services/yalidine');
const DeliveryDeskMapper = require('../utils/delivery-desk-mapper');

const router = express.Router();

// All admin routes require authentication
router.use(authenticateToken);
router.use(requireAnyRole);

// Dashboard stats
router.get('/dashboard/stats', async (req, res) => {
  try {
    const [totalOrders, totalProducts, totalUsers, recentOrders, totalRevenue, orderStatusBreakdown] = await Promise.all([
      prisma.order.count(),
      prisma.product.count(),
      prisma.user.count(),
      prisma.order.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            include: {
              product: true
            }
          }
        }
      }),
      // Calculate total revenue (excluding delivery fees)
      prisma.order.aggregate({
        _sum: {
          subtotal: true
        }
      }),
      // Get order status breakdown
      prisma.order.groupBy({
        by: ['callCenterStatus'],
        _count: {
          callCenterStatus: true
        }
      })
    ]);

    // Format order status breakdown
    const statusBreakdown = orderStatusBreakdown.reduce((acc, item) => {
      acc[item.callCenterStatus] = item._count.callCenterStatus;
      return acc;
    }, {});

    const finalTotalRevenue = totalRevenue._sum.subtotal || 0;

    console.log('🔍 Admin dashboard stats:', {
      totalOrders,
      totalProducts,
      totalUsers,
      totalRevenue: finalTotalRevenue,
      orderStatusBreakdown: statusBreakdown
    });

    res.json({
      totalOrders,
      totalProducts,
      totalUsers,
      totalRevenue: finalTotalRevenue,
      orderStatusBreakdown: statusBreakdown,
      recentOrders
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// Create new order (Admin/Wholesale) - Supports custom pricing
router.post('/orders', async (req, res) => {
  try {
    const orderData = req.body;
    console.log('Admin creating order:', orderData);

    // Basic validation
    if (!orderData.items || orderData.items.length === 0) {
      return res.status(400).json({ error: 'Items are required' });
    }
    if (!orderData.wilayaId) {
      return res.status(400).json({ error: 'Wilaya is required' });
    }

    // Get wilaya info
    const wilayaInfo = getWilayaById(parseInt(orderData.wilayaId));
    if (!wilayaInfo) {
      return res.status(400).json({ error: 'Invalid wilaya ID' });
    }

    // Find or create city
    let city = await prisma.city.findFirst({
      where: { name: wilayaInfo.name }
    });

    if (!city) {
      city = await prisma.city.create({
        data: {
          name: wilayaInfo.name,
          nameAr: wilayaInfo.nameAr,
          code: wilayaInfo.code,
          deliveryFee: 0,
          isActive: true
        }
      });
    }

    // Generate order number
    const lastOrder = await prisma.order.findFirst({
      orderBy: { createdAt: 'desc' },
      where: { orderNumber: { startsWith: 'ORD-' } }
    });

    let nextNum = 100;
    if (lastOrder && lastOrder.orderNumber) {
      const match = lastOrder.orderNumber.match(/ORD-(\d+)/);
      if (match) {
        nextNum = parseInt(match[1]) + 1;
      }
    }
    const orderNumber = `ORD-${String(nextNum).padStart(6, '0')}`;

    // Process items and calculate totals
    let subtotal = 0;
    const orderItems = [];

    for (const item of orderData.items) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId }
      });

      if (!product) {
        return res.status(400).json({ error: `Product not found: ${item.productId}` });
      }

      // Use provided wholesale price, or fallback to product price
      const itemPrice = parseFloat(item.price);
      if (isNaN(itemPrice)) {
        return res.status(400).json({ error: `Invalid price for product: ${product.name}` });
      }

      const itemTotal = itemPrice * item.quantity;
      subtotal += itemTotal;

      orderItems.push({
        productId: item.productId,
        quantity: item.quantity,
        price: itemPrice, // Store the custom wholesale price
        size: item.size || null,
        sizeId: item.sizeId || null
      });
    }

    const deliveryFee = orderData.deliveryFee !== undefined ? parseFloat(orderData.deliveryFee) : 0;
    const total = subtotal + deliveryFee;

    // Create the order
    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerName: orderData.customerName,
        customerPhone: orderData.customerPhone,
        customerEmail: orderData.customerEmail,
        customerInstagram: orderData.customerInstagram,
        deliveryType: orderData.deliveryType || 'HOME_DELIVERY',
        deliveryAddress: orderData.deliveryAddress,
        deliveryFee,
        subtotal,
        total,
        notes: orderData.notes ? `[WHOLESALE] ${orderData.notes}` : '[WHOLESALE]',
        cityId: city.id,
        callCenterStatus: 'NEW', // Must use the Prisma Enum value 'NEW' (which maps to nouveau in UI)
        deliveryDetails: {
          wilayaId: String(orderData.wilayaId),
          wilayaName: wilayaInfo.name,
          communeName: orderData.communeName
        },
        items: {
          create: orderItems
        }
      },
      include: {
        items: true,
        city: true
      }
    });

    res.status(201).json(order);

  } catch (error) {
    console.error('Create admin order error:', error);
    require('fs').writeFileSync('wholesale-error.txt', JSON.stringify({
      payload: req.body,
      message: error.message,
      stack: error.stack
    }, null, 2));
    res.status(500).json({ error: 'Failed to create wholesale order', details: error.message });
  }
});

// Recent orders
router.get('/dashboard/recent-orders', async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: {
            product: true
          }
        }
      }
    });

    res.json(orders);
  } catch (error) {
    console.error('Recent orders error:', error);
    res.status(500).json({ error: 'Failed to fetch recent orders' });
  }
});

// Low stock products
router.get('/dashboard/low-stock', async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: {
        stock: { lte: 5 },
        isActive: true
      },
      include: {
        category: true,
        images: {
          where: { isPrimary: true },
          take: 1
        }
      },
      take: 10
    });

    // Format products to include image field
    const formattedProducts = products.map(product => ({
      ...product,
      image: product.images[0]?.url || '/placeholder-product.jpg'
    }));

    res.json(formattedProducts);
  } catch (error) {
    console.error('Low stock products error:', error);
    res.status(500).json({ error: 'Failed to fetch low stock products' });
  }
});

// Admin products management
router.get('/products', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, category, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nameAr: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (category) {
      where.category = { slug: category };
    }

    if (status === 'active') {
      where.isActive = true;
    } else if (status === 'inactive') {
      where.isActive = false;
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: true,
          sizes: true, // Included sizes for the wholesale quantity modal
          images: {
            where: { isPrimary: true },
            take: 1
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.product.count({ where })
    ]);

    res.json({
      products: products.map(product => ({
        ...product,
        image: product.images[0]?.url || '/placeholder-product.jpg'
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Admin products error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Create product
router.post('/products', async (req, res) => {
  try {
    const productData = req.body;

    // Validate brandId is provided
    if (!productData.brandId) {
      return res.status(400).json({ error: 'Brand ID is required' });
    }

    // Check if brand exists
    const brand = await prisma.brand.findUnique({
      where: { id: productData.brandId }
    });

    if (!brand) {
      return res.status(400).json({ error: 'Brand not found' });
    }

    // Parse the requested displayPriority
    const requestedPriority = productData.displayPriority !== undefined && productData.displayPriority !== '' && productData.displayPriority !== null
      ? parseInt(productData.displayPriority, 10)
      : null;

    // Shift existing priorities if a explicit priority is requested
    if (requestedPriority !== null) {
      await prisma.product.updateMany({
        where: {
          displayPriority: { gte: requestedPriority }
        },
        data: {
          displayPriority: { increment: 1 }
        }
      });
    }

    // First create the product
    const product = await prisma.product.create({
      data: {
        name: productData.name,
        nameAr: productData.nameAr,
        description: productData.description,
        descriptionAr: productData.descriptionAr,
        price: parseFloat(productData.price),
        costPrice: parseFloat(productData.costPrice || 0),
        oldPrice: productData.oldPrice ? parseFloat(productData.oldPrice) : null,
        stock: parseInt(productData.stock),
        reference: productData.reference,
        isOnSale: productData.isOnSale || false,
        isActive: productData.isActive !== false,
        isLaunch: productData.isLaunch || false,
        isOutOfStock: productData.isOutOfStock || false,
        launchAt: productData.launchAt ? new Date(productData.launchAt) : null,
        displayPriority: requestedPriority,
        brandId: productData.brandId,
        categoryId: productData.categoryId,
        slug: productData.slug
      }
    });

    // Then create the images if provided
    if (productData.images && productData.images.length > 0) {
      await prisma.productImage.createMany({
        data: productData.images.map((img, index) => ({
          url: img.url,
          alt: img.alt || `${productData.name} image ${index + 1}`,
          isPrimary: index === 0,
          productId: product.id
        }))
      });
    }

    // Create the sizes if provided
    if (productData.sizes && productData.sizes.length > 0) {
      await prisma.productSize.createMany({
        data: productData.sizes.map((size) => ({
          size: size.size,
          stock: parseInt(size.stock) || 0,
          productId: product.id
        }))
      });
    }

    // Return the product with images and sizes
    const productWithImages = await prisma.product.findUnique({
      where: { id: product.id },
      include: {
        category: true,
        brand: true,
        images: true,
        sizes: true
      }
    });

    res.status(201).json(productWithImages);
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// Bulk update wholesale prices
router.put('/products/wholesale-prices', async (req, res) => {
  try {
    const { updates } = req.body;

    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'Valid updates array is required' });
    }

    // Process updates in a transaction for safety
    const updatePromises = updates.map(update =>
      prisma.product.update({
        where: { id: update.id },
        data: { wholesalePrice: update.wholesalePrice }
      })
    );

    await prisma.$transaction(updatePromises);

    res.json({ message: 'Wholesale prices updated successfully' });
  } catch (error) {
    console.error('Update wholesale prices error:', error);
    res.status(500).json({ error: 'Failed to update wholesale prices' });
  }
});

// Get single product by ID
router.get('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        images: true,
        sizes: true
      }
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    console.error('Get admin product error:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Update product
router.put('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const productData = req.body;

    // Check if product exists
    const existingProduct = await prisma.product.findUnique({
      where: { id }
    });

    if (!existingProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Build update data object with only provided fields
    const updateData = {};

    if (productData.name !== undefined) updateData.name = productData.name;
    if (productData.nameAr !== undefined) updateData.nameAr = productData.nameAr;
    if (productData.description !== undefined) updateData.description = productData.description;
    if (productData.descriptionAr !== undefined) updateData.descriptionAr = productData.descriptionAr;
    if (productData.price !== undefined) updateData.price = parseFloat(productData.price);
    if (productData.costPrice !== undefined) updateData.costPrice = parseFloat(productData.costPrice || 0);
    if (productData.oldPrice !== undefined) updateData.oldPrice = productData.oldPrice ? parseFloat(productData.oldPrice) : null;
    if (productData.stock !== undefined) updateData.stock = parseInt(productData.stock);
    if (productData.reference !== undefined) updateData.reference = productData.reference;
    if (productData.isOnSale !== undefined) updateData.isOnSale = productData.isOnSale;
    if (productData.isActive !== undefined) updateData.isActive = productData.isActive;
    if (productData.isLaunch !== undefined) updateData.isLaunch = productData.isLaunch;
    if (productData.isOutOfStock !== undefined) updateData.isOutOfStock = productData.isOutOfStock;
    if (productData.launchAt !== undefined) updateData.launchAt = productData.launchAt ? new Date(productData.launchAt) : null;
    if (productData.categoryId !== undefined) updateData.categoryId = productData.categoryId;
    if (productData.slug !== undefined) updateData.slug = productData.slug;
    if (productData.displayPriority !== undefined) updateData.displayPriority = productData.displayPriority === '' || productData.displayPriority === null ? null : parseInt(productData.displayPriority, 10);

    // Handle displayPriority auto-shifting logic
    let shiftQueries = [];
    const oldPriority = existingProduct.displayPriority;
    const newPriority = updateData.displayPriority;

    if (newPriority !== undefined && newPriority !== oldPriority) {
      if (newPriority !== null) {
        if (oldPriority === null) {
          // Scenario A: Adding a new priority where there was none
          shiftQueries.push(
            prisma.product.updateMany({
              where: {
                id: { not: id },
                displayPriority: { gte: newPriority }
              },
              data: {
                displayPriority: { increment: 1 }
              }
            })
          );
        } else if (newPriority < oldPriority) {
          // Scenario B: Moving UP in priority (e.g. 5 to 2) 
          // Products at 2, 3, 4 shift down to 3, 4, 5
          shiftQueries.push(
            prisma.product.updateMany({
              where: {
                id: { not: id },
                displayPriority: {
                  gte: newPriority,
                  lt: oldPriority
                }
              },
              data: {
                displayPriority: { increment: 1 }
              }
            })
          );
        } else if (newPriority > oldPriority) {
          // Scenario C: Moving DOWN in priority (e.g. 2 to 5)
          // Products at 3, 4, 5 shift up to 2, 3, 4
          shiftQueries.push(
            prisma.product.updateMany({
              where: {
                id: { not: id },
                displayPriority: {
                  gt: oldPriority,
                  lte: newPriority
                }
              },
              data: {
                displayPriority: { decrement: 1 }
              }
            })
          );
        }
      } else if (oldPriority !== null && newPriority === null) {
        // Scenario D: Removing a priority (e.g. 3 to null)
        // Products at 4, 5, etc. shift up by 1 block
        shiftQueries.push(
          prisma.product.updateMany({
            where: {
              id: { not: id },
              displayPriority: { gt: oldPriority }
            },
            data: {
              displayPriority: { decrement: 1 }
            }
          })
        );
      }
    }

    // Process shifts first if any
    if (shiftQueries.length > 0) {
      await prisma.$transaction(shiftQueries);
    }

    // Update the product
    const product = await prisma.product.update({
      where: { id },
      data: updateData
    });

    // Update images if provided
    if (productData.images) {
      // Delete existing images
      await prisma.productImage.deleteMany({
        where: { productId: id }
      });

      // Create new images
      if (productData.images.length > 0) {
        await prisma.productImage.createMany({
          data: productData.images.map((img, index) => ({
            url: img.url,
            alt: img.alt || `${productData.name || existingProduct.name} image ${index + 1}`,
            isPrimary: index === 0,
            productId: id
          }))
        });
      }
    }

    // Update sizes if provided
    if (productData.sizes) {
      // Delete existing sizes
      await prisma.productSize.deleteMany({
        where: { productId: id }
      });

      // Create new sizes
      if (productData.sizes.length > 0) {
        await prisma.productSize.createMany({
          data: productData.sizes.map((size) => ({
            size: size.size,
            stock: parseInt(size.stock) || 0,
            productId: id
          }))
        });
      }
    }

    // Return the updated product with images and sizes
    const productWithImages = await prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        brand: true,
        images: true,
        sizes: true
      }
    });

    res.json(productWithImages);
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Delete product
router.delete('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.product.delete({
      where: { id }
    });

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Admin orders management
router.get('/orders', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search, confirmedOnly } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};

    if (status) {
      where.callCenterStatus = status;
    }

    // If confirmedOnly is true, only return confirmed orders
    if (confirmedOnly === 'true') {
      where.callCenterStatus = 'CONFIRMED';
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerPhone: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [orders, total, statusCounts] = await Promise.all([
      prisma.order.findMany({
        where,
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
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.order.count({ where }),
      // Get total counts by status (without filters for stats cards)
      prisma.order.groupBy({
        by: ['callCenterStatus'],
        _count: {
          callCenterStatus: true
        }
      })
    ]);

    // Format orders to include proper structure
    const formattedOrders = orders.map(order => ({
      ...order,
      items: order.items.map(item => ({
        ...item,
        product: {
          ...item.product,
          image: item.product.images[0]?.url || '/placeholder-product.jpg'
        }
      }))
    }));

    // Format status counts into an object
    const statusBreakdown = statusCounts.reduce((acc, item) => {
      acc[item.callCenterStatus] = item._count.callCenterStatus;
      return acc;
    }, {});

    // Calculate total orders (sum of all statuses)
    const totalOrders = Object.values(statusBreakdown).reduce((sum, count) => sum + count, 0);

    res.json({
      orders: formattedOrders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      stats: {
        totalOrders,
        statusBreakdown
      }
    });
  } catch (error) {
    console.error('Admin orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Export orders to JSON (for Excel conversion on frontend with proper UTF-8 handling)
router.get('/orders/export', async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        items: {
          include: {
            product: true
          }
        },
        city: true,
        deliveryDesk: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Prepare data for Excel export with proper UTF-8 handling
    const exportData = orders.map(order => {
      const items = order.items.map(item =>
        `${item.quantity}x ${item.product.name}${item.size ? ` (Size: ${item.size})` : ''}`
      ).join('; ');

      const deliveryInfo = order.deliveryType === 'HOME_DELIVERY'
        ? (order.deliveryAddress || 'Home Delivery')
        : (order.deliveryDesk?.name || 'Pickup');

      return {
        'Order Number': order.orderNumber,
        'Customer Name': order.customerName,
        'Customer Phone': order.customerPhone,
        'Customer Email': order.customerEmail || '',
        'Customer Instagram': order.customerInstagram || '',
        'Order Date': new Date(order.createdAt).toLocaleDateString(),
        'Delivery Type': order.deliveryType === 'HOME_DELIVERY' ? 'Home Delivery' : 'Pickup',
        'City': order.city.name,
        'Delivery Address/Desk': deliveryInfo,
        'Call Center Status': order.callCenterStatus,
        'Delivery Status': order.deliveryStatus,
        'Subtotal (DA)': order.subtotal.toLocaleString(),
        'Delivery Fee (DA)': order.deliveryFee.toLocaleString(),
        'Total (DA)': order.total.toLocaleString(),
        'Items': items,
        'Notes': order.notes || '',
        'Yalidine Tracking': order.trackingNumber || ''
      };
    });

    res.json({ orders: exportData });
  } catch (error) {
    console.error('Export orders error:', error);
    res.status(500).json({ error: 'Failed to export orders' });
  }
});

// Update order details
router.put('/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customerName,
      customerPhone,
      deliveryType,
      deliveryAddress,
      cityId,
      deliveryDeskId,
      subtotal,
      total,
      deliveryFee,
      notes
    } = req.body;

    const updateData = {};
    if (customerName) updateData.customerName = customerName;
    if (customerPhone) updateData.customerPhone = customerPhone;
    if (deliveryType) updateData.deliveryType = deliveryType;
    if (deliveryAddress !== undefined) updateData.deliveryAddress = deliveryAddress;
    if (subtotal !== undefined) updateData.subtotal = parseFloat(subtotal);
    if (total !== undefined) updateData.total = parseFloat(total);
    if (deliveryFee !== undefined) updateData.deliveryFee = parseFloat(deliveryFee);
    if (notes !== undefined) updateData.notes = notes;

    // Handle city/desk updates
    if (cityId) {
      // Since users pass ID, but schema might expect connection by Code if we changed it?
      // Let's stick to connecting by ID if it's a relation.
      // EXCEPT we changed status route to use `code` for city. 
      // Let's check schema. `cityId` is String. `City` model has `id`.
      // Let's safe connect by ID.
      updateData.city = { connect: { id: cityId } };
    }

    if (deliveryDeskId) {
      updateData.deliveryDesk = { connect: { id: deliveryDeskId } };
    } else if (deliveryType === 'HOME_DELIVERY') {
      // Disconnect desk if home delivery
      updateData.deliveryDesk = { disconnect: true };
    }

    const order = await prisma.order.update({
      where: { id },
      data: updateData,
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

    res.json(order);
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// Add item to order
router.post('/orders/:id/items', async (req, res) => {
  try {
    const { id } = req.params;
    const { productId, quantity, price, size, color } = req.body;

    const item = await prisma.orderItem.create({
      data: {
        orderId: id,
        productId,
        quantity: parseInt(quantity),
        price: parseFloat(price),
        size: size || null,
        color: color || null
      },
      include: {
        product: true
      }
    });

    // Recalculate order totals
    // Ideally we should sum all items
    // For now, client usually manages state or reloads. 
    // But backend should probably ensure consistency?
    // Let's trigger a recalculation helper if we had one.
    // We'll rely on client to send updated subtotal via PUT order later, OR client refreshes.

    res.json(item);
  } catch (error) {
    console.error('Add item error:', error);
    res.status(500).json({ error: 'Failed to add item' });
  }
});

// Update order item
router.put('/orders/:id/items/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { quantity, price, size, color } = req.body;

    const updateData = {};
    if (quantity) updateData.quantity = parseInt(quantity);
    if (price) updateData.price = parseFloat(price);
    if (size !== undefined) updateData.size = size;
    if (color !== undefined) updateData.color = color;

    const item = await prisma.orderItem.update({
      where: { id: itemId },
      data: updateData,
      include: { product: true }
    });

    res.json(item);
  } catch (error) {
    console.error('Update item error:', error);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// Delete order item
router.delete('/orders/:id/items/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    await prisma.orderItem.delete({
      where: { id: itemId }
    });
    res.json({ message: 'Item deleted' });
  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// Update order status
router.patch('/orders/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      callCenterStatus,
      deliveryStatus,
      notes,
      appendNote, // New field for appending notes
      deliveryType,
      deliveryAddress,
      deliveryDeskId,
      deliveryFee,
      total,
      trackingNumber,
      yalidineShipmentId,
      deliveryDetails,
      cityId
    } = req.body;

    // Get current order to check status changes
    const currentOrder = await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            productSize: true
          }
        }
      }
    });

    if (!currentOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const updateData = {};
    if (callCenterStatus) updateData.callCenterStatus = callCenterStatus;
    if (deliveryStatus) updateData.deliveryStatus = deliveryStatus;

    // Handle notes update (overwrite or append)
    if (notes !== undefined) {
      updateData.notes = notes;
    } else if (appendNote) {
      // Append note with user attribution
      const userStr = req.user ? `${req.user.firstName} ${req.user.lastName} (${req.user.role})` : 'System';
      const timestamp = new Date().toLocaleString('fr-FR');
      const newNoteEntry = `[${timestamp}] ${userStr}: ${appendNote}`;

      updateData.notes = currentOrder.notes
        ? `${currentOrder.notes}\n---\n${newNoteEntry}`
        : newNoteEntry;
    }

    if (deliveryType) updateData.deliveryType = deliveryType;
    if (deliveryAddress !== undefined) updateData.deliveryAddress = deliveryAddress;

    // Handle delivery desk - for PICKUP orders, map Yalidine centerId to deliveryDeskId
    let finalDeliveryDeskId = deliveryDeskId;
    const effectiveDeliveryType = deliveryType || currentOrder.deliveryType;

    if (effectiveDeliveryType === 'PICKUP' && deliveryDetails && typeof deliveryDetails === 'object' && deliveryDetails.centerId && !finalDeliveryDeskId) {
      // If we have a centerId in deliveryDetails but no deliveryDeskId, map it
      try {
        const wilayaIdToUse = cityId || (deliveryDetails.wilayaId ? String(deliveryDetails.wilayaId) : null);
        if (wilayaIdToUse) {
          const wilaya = getWilayaById(parseInt(wilayaIdToUse));
          if (wilaya && wilaya.code) {
            const city = await prisma.city.findUnique({ where: { code: wilaya.code } });
            if (city) {
              const mappedDeskId = await DeliveryDeskMapper.findOrCreateDeliveryDesk(
                city.id,
                String(deliveryDetails.centerId),
                deliveryDetails.centerName || null
              );
              if (mappedDeskId) {
                finalDeliveryDeskId = mappedDeskId;
                console.log(`✅ Mapped Yalidine center ${deliveryDetails.centerId} to delivery desk ${mappedDeskId}`);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error mapping centerId to deliveryDeskId:', error);
        // Don't throw - continue with update without mapping
      }
    }

    // Handle delivery desk
    // If deliveryType changed to HOME_DELIVERY, disconnect delivery desk
    if (deliveryType === 'HOME_DELIVERY' && currentOrder.deliveryType === 'PICKUP') {
      updateData.deliveryDesk = { disconnect: true };
    } else if (finalDeliveryDeskId !== undefined || deliveryDeskId !== undefined) {
      const deskIdToUse = finalDeliveryDeskId !== undefined ? finalDeliveryDeskId : deliveryDeskId;
      if (deskIdToUse) {
        // Check if this looks like a Yalidine centerId (numeric) vs a deliveryDeskId (CUID string)
        // CUIDs are typically 25 characters, while Yalidine IDs are numeric
        const isNumericId = /^\d+$/.test(String(deskIdToUse));
        if (isNumericId && deliveryDetails && deliveryDetails.centerId) {
          // This is likely a Yalidine centerId, not a deliveryDeskId
          // The mapping should have handled this, but if it didn't, skip connection
          console.warn(`⚠️ Skipping connection: ${deskIdToUse} appears to be a Yalidine centerId, not a deliveryDeskId`);
        } else {
          // Verify the delivery desk exists before trying to connect
          try {
            const deskExists = await prisma.deliveryDesk.findUnique({
              where: { id: String(deskIdToUse) }
            });
            if (deskExists) {
              updateData.deliveryDesk = { connect: { id: String(deskIdToUse) } };
            } else {
              console.warn(`⚠️ Delivery desk ${deskIdToUse} not found, skipping connection`);
            }
          } catch (error) {
            console.error('Error verifying delivery desk:', error);
            // Skip delivery desk connection if there's an error
          }
        }
      } else if (deliveryDeskId === null || deliveryDeskId === '' || deliveryDeskId === undefined) {
        // Explicitly disconnecting (handles null, empty string, or undefined)
        updateData.deliveryDesk = { disconnect: true };
      }
    }

    if (deliveryFee !== undefined) updateData.deliveryFee = deliveryFee;
    if (total !== undefined) updateData.total = total;
    if (trackingNumber !== undefined) updateData.trackingNumber = trackingNumber;
    if (yalidineShipmentId !== undefined) updateData.yalidineShipmentId = yalidineShipmentId;

    // Handle detailed delivery info and city relation
    if (deliveryDetails !== undefined) {
      // Ensure deliveryDetails is a proper object (handle JSON strings)
      if (typeof deliveryDetails === 'string') {
        try {
          updateData.deliveryDetails = JSON.parse(deliveryDetails);
        } catch (e) {
          updateData.deliveryDetails = deliveryDetails;
        }
      } else {
        updateData.deliveryDetails = deliveryDetails;
      }
    }
    if (cityId) {
      try {
        const wilaya = getWilayaById(parseInt(cityId));
        if (wilaya && wilaya.code) {
          updateData.city = { connect: { code: wilaya.code } };
        }
      } catch (error) {
        console.error('Error connecting city:', error);
        // Continue without city update if there's an error
      }
    }

    // STOCK MANAGEMENT LOGIC
    // Stock is NOT decremented on order creation or confirmation
    // Stock is only decremented when scanning items in the smart inventory sortie section
    const oldStatus = currentOrder.callCenterStatus;
    const newStatus = callCenterStatus || oldStatus;

    // If canceling order (changing to CANCELED)
    if (newStatus === 'CANCELED' && oldStatus !== 'CANCELED') {
      console.log(`❌ Canceling order ${id} (${oldStatus} → CANCELED)`);

      // No stock restoration needed since we don't decrement on confirmation

      // Delete Yalidine tracking information
      if (currentOrder.trackingNumber || currentOrder.yalidineShipmentId) {
        console.log(`  🚚 Removing Yalidine tracking data`);

        // Try to delete from Yalidine
        if (currentOrder.trackingNumber) {
          try {
            await yalidineService.deleteParcel(currentOrder.trackingNumber);
            console.log(`  ✓ Yalidine parcel deleted: ${currentOrder.trackingNumber}`);
          } catch (yalidineError) {
            console.error(`  ⚠️ Failed to delete Yalidine parcel: ${yalidineError.message}`);
            // Continue with local cancellation even if remote fails
          }
        }

        updateData.trackingNumber = null;
        updateData.yalidineShipmentId = null;
        console.log(`  ✓ Yalidine tracking removed locally`);
      }
    }

    console.log('📝 Updating order with data:', JSON.stringify(updateData, null, 2));

    const order = await prisma.order.update({
      where: { id },
      data: updateData,
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
    });

    // Format order to include proper structure
    const formattedOrder = {
      ...order,
      items: order.items.map(item => ({
        ...item,
        product: {
          ...item.product,
          image: item.product.images[0]?.url || '/placeholder-product.jpg'
        }
      }))
    };

    res.json(formattedOrder);
  } catch (error) {
    console.error('Update order status error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      meta: error.meta
    });
    res.status(500).json({
      error: 'Failed to update order status',
      details: error.message || 'Unknown error',
      code: error.code || 'UNKNOWN_ERROR'
    });
  }
});

// Delete order
router.delete('/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🗑️ Deleting order ${id}`);

    // Get order details first to handle logic
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // No stock restoration needed since we don't decrement stock on order creation or confirmation
    // Stock is only decremented when scanning items in the smart inventory sortie section

    // 1. Delete from Yalidine if there's a tracking number
    if (order.trackingNumber) {
      console.log(`  🚚 Removing Yalidine parcel: ${order.trackingNumber}`);
      try {
        await yalidineService.deleteParcel(order.trackingNumber);
        console.log(`  ✓ Yalidine parcel deleted`);
      } catch (yalidineError) {
        console.error(`  ⚠️ Failed to delete Yalidine parcel: ${yalidineError.message}`);
        // We continue with local deletion even if this fails
      }
    }

    // 3. Delete order items first (if no cascade)
    // Checking schema is safest, but explicit delete is fine.
    await prisma.orderItem.deleteMany({
      where: { orderId: id }
    });

    // 4. Delete the order
    await prisma.order.delete({
      where: { id }
    });

    console.log(`  ✓ Order deleted locally`);
    res.json({ message: 'Order deleted successfully' });

  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

// Update order items
router.patch('/orders/:id/items', async (req, res) => {
  try {
    const { id } = req.params;
    const { items, subtotal, total } = req.body;

    // Validate input
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    if (typeof subtotal !== 'number' || typeof total !== 'number') {
      return res.status(400).json({ error: 'Subtotal and total must be numbers' });
    }

    // Start a transaction to update order items
    const result = await prisma.$transaction(async (tx) => {
      // Delete existing order items
      await tx.orderItem.deleteMany({
        where: { orderId: id }
      });

      // Create new order items
      const newItems = await Promise.all(
        items.map(async (item) => {
          // Get product details
          const product = await tx.product.findUnique({
            where: { id: item.product.id }
          });

          if (!product) {
            throw new Error(`Product not found: ${item.product.id}`);
          }

          return tx.orderItem.create({
            data: {
              orderId: id,
              productId: item.product.id,
              quantity: item.quantity,
              price: item.price,
              size: item.size || null
            },
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
          });
        })
      );

      // Update order totals
      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          subtotal,
          total
        },
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
      });

      return updatedOrder;
    });

    // Format order to include proper structure
    const formattedOrder = {
      ...result,
      items: result.items.map(item => ({
        ...item,
        product: {
          ...item.product,
          image: item.product.images[0]?.url || '/placeholder-product.jpg'
        }
      }))
    };

    res.json(formattedOrder);
  } catch (error) {
    console.error('Update order items error:', error);
    res.status(500).json({ error: 'Failed to update order items' });
  }
});

// Get users
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, role } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (role && role !== 'all') {
      where.role = role;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          createdAt: true,
          _count: {
            select: {
              orders: true
            }
          },
          orders: {
            select: {
              total: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.user.count({ where })
    ]);

    // Calculate total spent for each user
    const usersWithStats = users.map(user => {
      const totalSpent = user.orders.reduce((sum, order) => sum + order.total, 0);
      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        createdAt: user.createdAt,
        orderCount: user._count.orders,
        totalSpent: totalSpent
      };
    });

    res.json({
      users: usersWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create user
router.post('/users', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password, role } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const bcrypt = require('bcrypt');
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        phone: phone || null,
        password: hashedPassword,
        role: role || 'USER'
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        createdAt: true
      }
    });

    res.status(201).json({
      ...user,
      orderCount: 0,
      totalSpent: 0
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user (including role)
router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, email, phone, role, password } = req.body;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id }
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if email is taken by another user
    if (email && email !== existingUser.email) {
      const emailTaken = await prisma.user.findUnique({
        where: { email }
      });
      if (emailTaken) {
        return res.status(400).json({ error: 'Email already taken by another user' });
      }
    }

    // Prepare update data
    const updateData = {};
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (email) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone || null;
    if (role) updateData.role = role;

    // Hash new password if provided
    if (password) {
      const bcrypt = require('bcrypt');
      updateData.password = await bcrypt.hash(password, 10);
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            orders: true
          }
        },
        orders: {
          select: {
            total: true
          }
        }
      }
    });

    // Calculate total spent
    const totalSpent = updatedUser.orders.reduce((sum, order) => sum + order.total, 0);

    res.json({
      id: updatedUser.id,
      email: updatedUser.email,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      phone: updatedUser.phone,
      role: updatedUser.role,
      createdAt: updatedUser.createdAt,
      orderCount: updatedUser._count.orders,
      totalSpent: totalSpent
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            orders: true
          }
        }
      }
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has orders
    if (existingUser._count.orders > 0) {
      return res.status(400).json({
        error: 'Cannot delete user with existing orders. Consider deactivating instead.'
      });
    }

    // Delete user
    await prisma.user.delete({
      where: { id }
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Get categories by brand
router.get('/categories/brand/:brandSlug', async (req, res) => {
  try {
    const { brandSlug } = req.params;

    // Find the brand
    const brand = await prisma.brand.findUnique({
      where: { slug: brandSlug }
    });

    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const categories = await prisma.category.findMany({
      where: { brandId: brand.id },
      include: {
        _count: {
          select: {
            products: true
          }
        },
        brand: true
      },
      orderBy: { name: 'asc' }
    });

    res.json({
      categories: categories.map(category => ({
        ...category,
        productCount: category._count.products
      }))
    });
  } catch (error) {
    console.error('Admin brand categories error:', error);
    res.status(500).json({ error: 'Failed to fetch brand categories' });
  }
});

// Get categories
router.get('/categories', async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        _count: {
          select: {
            products: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    res.json(categories.map(category => ({
      ...category,
      productCount: category._count.products
    })));
  } catch (error) {
    console.error('Admin categories error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Get single category
router.get('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Admin: Fetching category with ID:', id);

    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            products: true
          }
        }
      }
    });

    console.log('Admin: Category found:', category ? category.name : 'null');

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const result = {
      ...category,
      productCount: category._count.products
    };

    console.log('Admin: Returning category data:', result.name);
    res.json(result);
  } catch (error) {
    console.error('Admin get category error:', error);
    res.status(500).json({ error: 'Failed to fetch category' });
  }
});

// Create category
router.post('/categories', async (req, res) => {
  try {
    const categoryData = req.body;

    // Validate brandId is provided
    if (!categoryData.brandId) {
      return res.status(400).json({ error: 'Brand ID is required' });
    }

    // Check if brand exists
    const brand = await prisma.brand.findUnique({
      where: { id: categoryData.brandId }
    });

    if (!brand) {
      return res.status(400).json({ error: 'Brand not found' });
    }

    // Create category with provided data
    const category = await prisma.category.create({
      data: {
        name: categoryData.name,
        nameAr: categoryData.nameAr,
        description: categoryData.description,
        descriptionAr: categoryData.descriptionAr,
        image: categoryData.image,
        slug: categoryData.slug,
        brandId: categoryData.brandId
      },
      include: {
        brand: true
      }
    });

    // Category created successfully
    res.status(201).json(category);
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Update category
router.put('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const categoryData = req.body;

    // Update category data

    const category = await prisma.category.update({
      where: { id },
      data: {
        name: categoryData.name,
        nameAr: categoryData.nameAr,
        description: categoryData.description,
        descriptionAr: categoryData.descriptionAr,
        image: categoryData.image,
        slug: categoryData.slug
      }
    });

    // Category updated successfully
    res.json(category);
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Delete category
router.delete('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if category has products
    const categoryWithProducts = await prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            products: true
          }
        }
      }
    });

    if (categoryWithProducts._count.products > 0) {
      return res.status(400).json({
        error: 'Cannot delete category with existing products'
      });
    }

    await prisma.category.delete({
      where: { id }
    });

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// Inventory management
router.get('/inventory', async (req, res) => {
  try {
    const { page = 1, limit = 50, search, category, stockFilter, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nameAr: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (category) {
      where.category = { slug: category };
    }

    if (stockFilter === 'low') {
      where.stock = { lte: 5, gt: 0 };
    } else if (stockFilter === 'out') {
      where.stock = 0;
    } else if (stockFilter === 'in') {
      where.stock = { gt: 5 };
    }

    if (status === 'active') {
      where.isActive = true;
    } else if (status === 'inactive') {
      where.isActive = false;
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: true,
          images: {
            where: { isPrimary: true },
            take: 1
          },
          sizes: {
            orderBy: { size: 'asc' }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.product.count({ where })
    ]);

    res.json({
      products: products.map(product => ({
        ...product,
        image: product.images[0]?.url || '/placeholder-product.jpg',
        totalStock: product.stock + product.sizes.reduce((sum, size) => sum + size.stock, 0)
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Inventory error:', error);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// Export inventory to Excel/CSV
router.get('/inventory/export', async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      include: {
        category: true,
        sizes: {
          orderBy: { size: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Create CSV content
    const headers = [
      'Reference',
      'Name',
      'Name (Arabic)',
      'Category',
      'Price (DA)',
      'Old Price (DA)',
      'Main Stock',
      'Sizes & Quantities',
      'Total Stock',
      'Status',
      'On Sale',
      'Created Date',
      'Description',
      'Description (Arabic)'
    ];

    const csvContent = [
      headers.join(','),
      ...products.map(product => {
        const sizesInfo = product.sizes.map(size => `${size.size}:${size.stock}`).join(';');
        const totalStock = product.stock + product.sizes.reduce((sum, size) => sum + size.stock, 0);

        return [
          product.reference || '',
          `"${product.name}"`,
          `"${product.nameAr || ''}"`,
          product.category?.name || '',
          product.price,
          product.oldPrice || '',
          product.stock,
          `"${sizesInfo}"`,
          totalStock,
          product.isActive ? 'Active' : 'Inactive',
          product.isOnSale ? 'Yes' : 'No',
          new Date(product.createdAt).toLocaleDateString(),
          `"${product.description || ''}"`,
          `"${product.descriptionAr || ''}"`
        ].join(',');
      })
    ].join('\n');

    // Set proper headers for CSV download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="inventory-${new Date().toISOString().split('T')[0]}.csv"`);
    res.setHeader('Cache-Control', 'no-cache');

    // Send the CSV content
    res.status(200).send(csvContent);
  } catch (error) {
    console.error('Export inventory error:', error);
    res.status(500).json({ error: 'Failed to export inventory' });
  }
});

// Brand-specific inventory management
router.get('/inventory/brand/:brandSlug', async (req, res) => {
  try {
    const { brandSlug } = req.params;
    const { page = 1, limit = 50, search, category, stockFilter, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Find the brand
    const brand = await prisma.brand.findUnique({
      where: { slug: brandSlug }
    });

    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const where = {
      brandId: brand.id
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nameAr: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (category) {
      where.category = { slug: category };
    }

    if (stockFilter === 'low') {
      where.stock = { lte: 5, gt: 0 };
    } else if (stockFilter === 'out') {
      where.stock = 0;
    } else if (stockFilter === 'in') {
      where.stock = { gt: 5 };
    }

    if (status === 'active') {
      where.isActive = true;
    } else if (status === 'inactive') {
      where.isActive = false;
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: true,
          brand: true,
          images: {
            where: { isPrimary: true },
            take: 1
          },
          sizes: {
            orderBy: { size: 'asc' }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.product.count({ where })
    ]);

    // Calculate profit analytics
    const productsWithProfit = products.map(product => {
      const totalStock = product.stock + product.sizes.reduce((sum, size) => sum + size.stock, 0);
      const profitPerUnit = product.price - product.costPrice;
      const totalProfit = profitPerUnit * totalStock;
      const profitMargin = product.price > 0 ? ((profitPerUnit / product.price) * 100) : 0;

      return {
        ...product,
        image: product.images[0]?.url || '/placeholder-product.jpg',
        totalStock,
        profitPerUnit,
        totalProfit,
        profitMargin
      };
    });

    // Calculate summary analytics
    const totalProducts = productsWithProfit.length;
    const totalStock = productsWithProfit.reduce((sum, p) => sum + p.totalStock, 0);
    const totalValue = productsWithProfit.reduce((sum, p) => sum + (p.price * p.totalStock), 0);
    const totalCost = productsWithProfit.reduce((sum, p) => sum + (p.costPrice * p.totalStock), 0);
    const totalProfit = productsWithProfit.reduce((sum, p) => sum + p.totalProfit, 0);
    const averageProfitMargin = totalValue > 0 ? ((totalProfit / totalValue) * 100) : 0;

    res.json({
      products: productsWithProfit,
      analytics: {
        totalProducts,
        totalStock,
        totalValue,
        totalCost,
        totalProfit,
        averageProfitMargin
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Brand inventory error:', error);
    res.status(500).json({ error: 'Failed to fetch brand inventory' });
  }
});

// Export brand-specific inventory to Excel/CSV
router.get('/inventory/brand/:brandSlug/export', async (req, res) => {
  try {
    const { brandSlug } = req.params;

    // Find the brand
    const brand = await prisma.brand.findUnique({
      where: { slug: brandSlug }
    });

    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const products = await prisma.product.findMany({
      where: { brandId: brand.id },
      include: {
        category: true,
        sizes: {
          orderBy: { size: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Create CSV content
    const headers = [
      'Reference',
      'Name',
      'Name (Arabic)',
      'Category',
      'Brand',
      'Price (DA)',
      'Cost Price (DA)',
      'Profit Per Unit (DA)',
      'Profit Margin (%)',
      'Old Price (DA)',
      'Main Stock',
      'Sizes & Quantities',
      'Total Stock',
      'Total Profit (DA)',
      'Status',
      'On Sale',
      'Description',
      'Description (Arabic)'
    ];

    const csvRows = [headers.join(',')];

    for (const product of products) {
      const totalStock = product.stock + product.sizes.reduce((sum, size) => sum + size.stock, 0);
      const profitPerUnit = product.price - product.costPrice;
      const totalProfit = profitPerUnit * totalStock;
      const profitMargin = product.price > 0 ? ((profitPerUnit / product.price) * 100) : 0;
      const sizesString = product.sizes.map(size => `${size.size}:${size.stock}`).join(';');

      const row = [
        `"${product.reference}"`,
        `"${product.name}"`,
        `"${product.nameAr || ''}"`,
        `"${product.category?.name || ''}"`,
        `"${brand.name}"`,
        product.price,
        product.costPrice,
        profitPerUnit,
        profitMargin.toFixed(2),
        product.oldPrice || '',
        product.stock,
        `"${sizesString}"`,
        totalStock,
        totalProfit,
        product.isActive ? 'Active' : 'Inactive',
        product.isOnSale ? 'Yes' : 'No',
        `"${product.description || ''}"`,
        `"${product.descriptionAr || ''}"`
      ];

      csvRows.push(row.join(','));
    }

    const csvContent = csvRows.join('\n');

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${brandSlug}-inventory-${new Date().toISOString().split('T')[0]}.csv"`);
    res.setHeader('Cache-Control', 'no-cache');

    // Send the CSV content
    res.status(200).send(csvContent);
  } catch (error) {
    console.error('Export brand inventory error:', error);
    res.status(500).json({ error: 'Failed to export brand inventory' });
  }
});

// Import inventory from Excel/CSV
router.post('/inventory/import', async (req, res) => {
  try {
    const { products } = req.body;

    if (!Array.isArray(products)) {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    const results = {
      created: 0,
      updated: 0,
      errors: []
    };

    for (const productData of products) {
      try {
        // Check if product exists by reference
        const existingProduct = await prisma.product.findUnique({
          where: { reference: productData.reference },
          include: { sizes: true }
        });

        if (existingProduct) {
          // Update existing product
          await prisma.product.update({
            where: { id: existingProduct.id },
            data: {
              name: productData.name,
              nameAr: productData.nameAr,
              description: productData.description,
              descriptionAr: productData.descriptionAr,
              price: parseFloat(productData.price) || 0,
              oldPrice: productData.oldPrice ? parseFloat(productData.oldPrice) : null,
              stock: parseInt(productData.mainStock) || 0,
              isOnSale: productData.isOnSale === 'Yes',
              isActive: productData.status === 'Active'
            }
          });

          // Update sizes if provided
          if (productData.sizes) {
            const sizesData = productData.sizes.split(';').map(sizeInfo => {
              const [size, stock] = sizeInfo.split(':');
              return { size: size.trim(), stock: parseInt(stock) || 0 };
            });

            // Delete existing sizes
            await prisma.productSize.deleteMany({
              where: { productId: existingProduct.id }
            });

            // Create new sizes
            for (const sizeData of sizesData) {
              await prisma.productSize.create({
                data: {
                  size: sizeData.size,
                  stock: sizeData.stock,
                  productId: existingProduct.id
                }
              });
            }
          }

          results.updated++;
        } else {
          // Create new product
          const newProduct = await prisma.product.create({
            data: {
              name: productData.name,
              nameAr: productData.nameAr,
              description: productData.description,
              descriptionAr: productData.descriptionAr,
              price: parseFloat(productData.price) || 0,
              oldPrice: productData.oldPrice ? parseFloat(productData.oldPrice) : null,
              stock: parseInt(productData.mainStock) || 0,
              reference: productData.reference,
              isOnSale: productData.isOnSale === 'Yes',
              isActive: productData.status === 'Active',
              slug: productData.reference.toLowerCase().replace(/\s+/g, '-')
            }
          });

          // Create sizes if provided
          if (productData.sizes) {
            const sizesData = productData.sizes.split(';').map(sizeInfo => {
              const [size, stock] = sizeInfo.split(':');
              return { size: size.trim(), stock: parseInt(stock) || 0 };
            });

            for (const sizeData of sizesData) {
              await prisma.productSize.create({
                data: {
                  size: sizeData.size,
                  stock: sizeData.stock,
                  productId: newProduct.id
                }
              });
            }
          }

          results.created++;
        }
      } catch (error) {
        results.errors.push({
          reference: productData.reference,
          error: error.message
        });
      }
    }

    res.json({
      message: 'Import completed',
      results
    });
  } catch (error) {
    console.error('Import inventory error:', error);
    res.status(500).json({ error: 'Failed to import inventory' });
  }
});

// Brand management routes
// Get all brands
router.get('/brands', async (req, res) => {
  try {
    const brands = await prisma.brand.findMany({
      orderBy: {
        name: 'asc'
      }
    });

    res.json(brands);
  } catch (error) {
    console.error('Get brands error:', error);
    res.status(500).json({ error: 'Failed to fetch brands' });
  }
});

// Get brand by ID
router.get('/brands/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const brand = await prisma.brand.findUnique({
      where: { id },
      include: {
        categories: true,
        products: true
      }
    });

    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    res.json(brand);
  } catch (error) {
    console.error('Get brand error:', error);
    res.status(500).json({ error: 'Failed to fetch brand' });
  }
});

// Create brand
router.post('/brands', async (req, res) => {
  try {
    const brandData = req.body;

    // Validate required fields
    if (!brandData.name || !brandData.slug) {
      return res.status(400).json({ error: 'Name and slug are required' });
    }

    // Check if brand with same name or slug already exists
    const existingBrand = await prisma.brand.findFirst({
      where: {
        OR: [
          { name: brandData.name },
          { slug: brandData.slug }
        ]
      }
    });

    if (existingBrand) {
      return res.status(400).json({ error: 'Brand with this name or slug already exists' });
    }

    const brand = await prisma.brand.create({
      data: {
        name: brandData.name,
        nameAr: brandData.nameAr,
        description: brandData.description,
        descriptionAr: brandData.descriptionAr,
        logo: brandData.logo,
        slug: brandData.slug,
        isActive: brandData.isActive !== false
      }
    });

    res.status(201).json(brand);
  } catch (error) {
    console.error('Create brand error:', error);
    res.status(500).json({ error: 'Failed to create brand' });
  }
});

// Update brand
router.put('/brands/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const brandData = req.body;

    // Check if brand exists
    const existingBrand = await prisma.brand.findUnique({
      where: { id }
    });

    if (!existingBrand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    // Check if name or slug conflicts with other brands
    if (brandData.name || brandData.slug) {
      const conflictingBrand = await prisma.brand.findFirst({
        where: {
          OR: [
            { name: brandData.name || existingBrand.name },
            { slug: brandData.slug || existingBrand.slug }
          ],
          NOT: {
            id
          }
        }
      });

      if (conflictingBrand) {
        return res.status(400).json({ error: 'Brand with this name or slug already exists' });
      }
    }

    const brand = await prisma.brand.update({
      where: { id },
      data: {
        name: brandData.name,
        nameAr: brandData.nameAr,
        description: brandData.description,
        descriptionAr: brandData.descriptionAr,
        logo: brandData.logo,
        slug: brandData.slug,
        isActive: brandData.isActive
      }
    });

    res.json(brand);
  } catch (error) {
    console.error('Update brand error:', error);
    res.status(500).json({ error: 'Failed to update brand' });
  }
});

// Delete brand
router.delete('/brands/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if brand exists
    const existingBrand = await prisma.brand.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            categories: true,
            products: true
          }
        }
      }
    });

    if (!existingBrand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    // Check if brand has categories or products
    if (existingBrand._count.categories > 0 || existingBrand._count.products > 0) {
      return res.status(400).json({
        error: 'Cannot delete brand with existing categories or products. Please reassign or delete them first.'
      });
    }

    await prisma.brand.delete({
      where: { id }
    });

    res.json({ message: 'Brand deleted successfully' });
  } catch (error) {
    console.error('Delete brand error:', error);
    res.status(500).json({ error: 'Failed to delete brand' });
  }
});

// Analytics - Most Ordered Products (Confirmed Orders)
router.get('/analytics/top-products', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const topProducts = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          callCenterStatus: 'CONFIRMED'
        }
      },
      _sum: {
        quantity: true
      },
      _count: {
        productId: true
      },
      orderBy: {
        _sum: {
          quantity: 'desc'
        }
      },
      take: parseInt(limit)
    });

    // Get product details for each top product
    const productIds = topProducts.map(item => item.productId);
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds }
      },
      select: {
        id: true,
        name: true,
        nameAr: true,
        price: true,
        images: {
          select: {
            url: true
          },
          take: 1
        }
      }
    });

    // Combine data
    const result = topProducts.map(item => {
      const product = products.find(p => p.id === item.productId);
      return {
        id: product?.id,
        name: product?.name,
        nameAr: product?.nameAr,
        price: product?.price,
        image: product?.images[0]?.url || '/placeholder-product.jpg',
        totalQuantity: item._sum.quantity,
        orderCount: item._count.productId,
        totalRevenue: (item._sum.quantity || 0) * (product?.price || 0)
      };
    }).filter(item => item.id); // Filter out any missing products

    res.json(result);
  } catch (error) {
    console.error('Top products analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch top products analytics' });
  }
});

// Analytics - Sales by Category (Confirmed Orders)
router.get('/analytics/sales-by-category', async (req, res) => {
  try {
    const salesByCategory = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          callCenterStatus: 'CONFIRMED'
        }
      },
      _sum: {
        quantity: true
      },
      _count: {
        productId: true
      }
    });

    // Get products with their categories
    const productIds = salesByCategory.map(item => item.productId);
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds }
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            nameAr: true
          }
        }
      }
    });

    // Group by category
    const categorySales = {};
    let totalSales = 0;

    salesByCategory.forEach(item => {
      const product = products.find(p => p.id === item.productId);
      if (product && product.category) {
        const categoryId = product.category.id;
        const categoryName = product.category.name;
        const categoryNameAr = product.category.nameAr;

        if (!categorySales[categoryId]) {
          categorySales[categoryId] = {
            categoryId,
            categoryName,
            categoryNameAr,
            totalQuantity: 0,
            orderCount: 0,
            totalRevenue: 0
          };
        }

        const quantity = item._sum.quantity || 0;
        const revenue = quantity * product.price;

        categorySales[categoryId].totalQuantity += quantity;
        categorySales[categoryId].orderCount += item._count.productId;
        categorySales[categoryId].totalRevenue += revenue;
        totalSales += quantity;
      }
    });

    // Convert to array and calculate percentages
    const result = Object.values(categorySales).map(category => ({
      ...category,
      percentage: totalSales > 0 ? ((category.totalQuantity / totalSales) * 100) : 0
    })).sort((a, b) => b.totalQuantity - a.totalQuantity);

    res.json(result);
  } catch (error) {
    console.error('Sales by category analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch sales by category analytics' });
  }
});

// Analytics - Orders by City (Confirmed Orders)
router.get('/analytics/orders-by-city', async (req, res) => {
  try {
    const ordersByCity = await prisma.order.groupBy({
      by: ['cityId'],
      where: {
        callCenterStatus: 'CONFIRMED'
      },
      _count: {
        cityId: true
      },
      orderBy: {
        _count: {
          cityId: 'desc'
        }
      }
    });

    // Get city details
    const cityIds = ordersByCity.map(item => item.cityId);
    const cities = await prisma.city.findMany({
      where: {
        id: { in: cityIds }
      },
      select: {
        id: true,
        name: true,
        nameAr: true
      }
    });

    // Calculate total orders for percentage calculation
    const totalOrders = ordersByCity.reduce((sum, item) => sum + item._count.cityId, 0);

    // Combine data
    const result = ordersByCity.map(item => {
      const city = cities.find(c => c.id === item.cityId);
      return {
        cityId: city?.id,
        cityName: city?.name,
        cityNameAr: city?.nameAr,
        orders: item._count.cityId,
        percentage: totalOrders > 0 ? ((item._count.cityId / totalOrders) * 100) : 0
      };
    }).filter(item => item.cityId); // Filter out any missing cities

    res.json(result);
  } catch (error) {
    console.error('Orders by city analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch orders by city analytics' });
  }
});

// Profit Analytics by Category
router.get('/analytics/profit-by-category', async (req, res) => {
  try {
    const { brandSlug } = req.query;

    let where = {};
    if (brandSlug) {
      const brand = await prisma.brand.findUnique({
        where: { slug: brandSlug }
      });
      if (!brand) {
        return res.status(404).json({ error: 'Brand not found' });
      }
      where.brandId = brand.id;
    }

    // Get products with their sales data from confirmed orders
    const products = await prisma.product.findMany({
      where,
      include: {
        category: true,
        brand: true,
        sizes: true,
        orderItems: {
          where: {
            order: {
              callCenterStatus: 'CONFIRMED'
            }
          },
          select: {
            quantity: true,
            price: true
          }
        }
      }
    });

    // Group products by category and calculate profit analytics
    const categoryAnalytics = {};

    products.forEach(product => {
      const totalStock = product.stock + product.sizes.reduce((sum, size) => sum + size.stock, 0);
      const profitPerUnit = product.price - product.costPrice;

      // Calculate actual sales from confirmed orders
      const actualSales = product.orderItems.reduce((sum, item) => sum + item.quantity, 0);
      const actualRevenue = product.orderItems.reduce((sum, item) => sum + (item.quantity * item.price), 0);
      const actualCost = actualSales * product.costPrice;
      const actualProfit = actualRevenue - actualCost;

      // Calculate theoretical profit (based on current stock)
      const theoreticalProfit = profitPerUnit * totalStock;
      const totalValue = product.price * totalStock;
      const totalCost = product.costPrice * totalStock;

      const categoryKey = product.category.id;

      if (!categoryAnalytics[categoryKey]) {
        categoryAnalytics[categoryKey] = {
          categoryId: product.category.id,
          categoryName: product.category.name,
          categoryNameAr: product.category.nameAr,
          brandName: product.brand.name,
          totalProducts: 0,
          totalStock: 0,
          totalValue: 0,
          totalCost: 0,
          totalProfit: 0,
          actualSales: 0,
          actualRevenue: 0,
          actualCost: 0,
          actualProfit: 0,
          averageProfitMargin: 0,
          actualProfitMargin: 0,
          products: []
        };
      }

      categoryAnalytics[categoryKey].totalProducts++;
      categoryAnalytics[categoryKey].totalStock += totalStock;
      categoryAnalytics[categoryKey].totalValue += totalValue;
      categoryAnalytics[categoryKey].totalCost += totalCost;
      categoryAnalytics[categoryKey].totalProfit += theoreticalProfit;
      categoryAnalytics[categoryKey].actualSales += actualSales;
      categoryAnalytics[categoryKey].actualRevenue += actualRevenue;
      categoryAnalytics[categoryKey].actualCost += actualCost;
      categoryAnalytics[categoryKey].actualProfit += actualProfit;

      categoryAnalytics[categoryKey].products.push({
        id: product.id,
        name: product.name,
        nameAr: product.nameAr,
        price: product.price,
        costPrice: product.costPrice,
        stock: totalStock,
        profitPerUnit,
        totalProfit: theoreticalProfit,
        profitMargin: product.price > 0 ? ((profitPerUnit / product.price) * 100) : 0,
        actualSales,
        actualRevenue,
        actualCost,
        actualProfit,
        actualProfitMargin: actualRevenue > 0 ? ((actualProfit / actualRevenue) * 100) : 0
      });
    });

    // Calculate average profit margin for each category
    Object.values(categoryAnalytics).forEach(category => {
      category.averageProfitMargin = category.totalValue > 0 ?
        ((category.totalProfit / category.totalValue) * 100) : 0;
      category.actualProfitMargin = category.actualRevenue > 0 ?
        ((category.actualProfit / category.actualRevenue) * 100) : 0;
    });

    // Convert to array and sort by actual profit (real sales data)
    const categoryAnalyticsArray = Object.values(categoryAnalytics)
      .sort((a, b) => b.actualProfit - a.actualProfit);

    // Calculate global analytics
    const globalAnalytics = {
      totalCategories: categoryAnalyticsArray.length,
      totalProducts: categoryAnalyticsArray.reduce((sum, cat) => sum + cat.totalProducts, 0),
      totalStock: categoryAnalyticsArray.reduce((sum, cat) => sum + cat.totalStock, 0),
      totalValue: categoryAnalyticsArray.reduce((sum, cat) => sum + cat.totalValue, 0),
      totalCost: categoryAnalyticsArray.reduce((sum, cat) => sum + cat.totalCost, 0),
      totalProfit: categoryAnalyticsArray.reduce((sum, cat) => sum + cat.totalProfit, 0),
      totalActualSales: categoryAnalyticsArray.reduce((sum, cat) => sum + cat.actualSales, 0),
      totalActualRevenue: categoryAnalyticsArray.reduce((sum, cat) => sum + cat.actualRevenue, 0),
      totalActualCost: categoryAnalyticsArray.reduce((sum, cat) => sum + cat.actualCost, 0),
      totalActualProfit: categoryAnalyticsArray.reduce((sum, cat) => sum + cat.actualProfit, 0),
      averageProfitMargin: 0,
      actualProfitMargin: 0
    };

    globalAnalytics.averageProfitMargin = globalAnalytics.totalValue > 0 ?
      ((globalAnalytics.totalProfit / globalAnalytics.totalValue) * 100) : 0;
    globalAnalytics.actualProfitMargin = globalAnalytics.totalActualRevenue > 0 ?
      ((globalAnalytics.totalActualProfit / globalAnalytics.totalActualRevenue) * 100) : 0;

    res.json({
      globalAnalytics,
      categoryAnalytics: categoryAnalyticsArray
    });
  } catch (error) {
    console.error('Profit analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch profit analytics' });
  }
});

// Comprehensive Analytics Dashboard Endpoint
router.get('/analytics/comprehensive', async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    // Get all confirmed orders (CONFIRMED callCenterStatus)
    const confirmedOrders = await prisma.order.findMany({
      where: {
        callCenterStatus: 'CONFIRMED'
      },
      include: {
        items: {
          include: {
            product: {
              include: {
                category: {
                  select: {
                    id: true,
                    name: true,
                    nameAr: true
                  }
                },
                images: {
                  where: {
                    isPrimary: true
                  },
                  take: 1
                }
              }
            }
          }
        }
      }
    });

    // Calculate Total Revenue (sum of confirmed orders subtotals)
    const totalRevenue = confirmedOrders.reduce((sum, order) => sum + (order.subtotal || 0), 0);

    // Calculate Total Net Profit (Selling Price - Buying Price for confirmed items)
    let totalNetProfit = 0;
    confirmedOrders.forEach(order => {
      if (order.items && order.items.length > 0) {
        order.items.forEach(item => {
          if (item.product) {
            const itemPrice = item.price || 0;
            const costPrice = item.product.costPrice || 0;
            const quantity = item.quantity || 0;
            const profitPerUnit = itemPrice - costPrice;
            totalNetProfit += profitPerUnit * quantity;
          }
        });
      }
    });

    // Calculate Stock Valuation
    const allProducts = await prisma.product.findMany({
      include: {
        sizes: true
      }
    });

    let stockValuationCost = 0; // At buying price
    let stockValuationRetail = 0; // At selling price

    allProducts.forEach(product => {
      // Stock = sum of sizes' stock if sizes exist, otherwise use product.stock
      // Don't add product.stock + sizes.stock (that would double count)
      let totalStock = 0;
      if (product.sizes && product.sizes.length > 0) {
        // If product has sizes, use sum of sizes' stock
        totalStock = product.sizes.reduce((sum, size) => sum + (size.stock || 0), 0);
      } else {
        // If product has no sizes, use product.stock
        totalStock = product.stock || 0;
      }
      const costPrice = product.costPrice || 0;
      const price = product.price || 0;
      stockValuationCost += costPrice * totalStock;
      stockValuationRetail += price * totalStock;
    });

    // Calculate Delivery Success Rate (Yalidine Livre = orders with trackingNumber)
    const shippedOrders = await prisma.order.findMany({
      where: {
        deliveryStatus: {
          in: ['IN_TRANSIT', 'DONE']
        }
      }
    });

    const yalidineLivreOrders = shippedOrders.filter(order => order.trackingNumber).length;
    const totalShipped = shippedOrders.length;
    const deliverySuccessRate = totalShipped > 0 ? (yalidineLivreOrders / totalShipped) * 100 : 0;

    // Get orders by city (for confirmed orders)
    const ordersByCityData = await prisma.order.groupBy({
      by: ['cityId'],
      where: {
        callCenterStatus: 'CONFIRMED'
      },
      _count: {
        cityId: true
      }
    });

    const cityIds = ordersByCityData.map(item => item.cityId);
    const cities = await prisma.city.findMany({
      where: {
        id: { in: cityIds }
      },
      select: {
        id: true,
        name: true,
        nameAr: true
      }
    });

    const ordersByCity = ordersByCityData.map(item => {
      const city = cities.find(c => c.id === item.cityId);
      return {
        cityId: city?.id || item.cityId,
        cityName: city?.name || 'Unknown',
        cityNameAr: city?.nameAr,
        orders: item._count.cityId
      };
    }).sort((a, b) => b.orders - a.orders);

    // Get top categories (from confirmed orders)
    const categorySales = {};
    confirmedOrders.forEach(order => {
      if (order.items && order.items.length > 0) {
        order.items.forEach(item => {
          if (item.product && item.product.category) {
            const categoryId = item.product.category.id;
            if (!categorySales[categoryId]) {
              categorySales[categoryId] = {
                categoryId,
                quantity: 0,
                revenue: 0
              };
            }
            const quantity = item.quantity || 0;
            const itemPrice = item.price || 0;
            categorySales[categoryId].quantity += quantity;
            categorySales[categoryId].revenue += itemPrice * quantity;
          }
        });
      }
    });

    const topCategories = Object.values(categorySales)
      .map(cat => {
        // Find category from first order item that has this category
        let categoryInfo = null;
        for (const order of confirmedOrders) {
          for (const item of order.items) {
            if (item.product.category && item.product.category.id === cat.categoryId) {
              categoryInfo = item.product.category;
              break;
            }
          }
          if (categoryInfo) break;
        }

        return {
          categoryId: cat.categoryId,
          categoryName: categoryInfo?.name || 'Unknown',
          categoryNameAr: categoryInfo?.nameAr,
          quantity: cat.quantity,
          revenue: cat.revenue
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Get top products (from confirmed orders)
    const productSales = {};
    confirmedOrders.forEach(order => {
      if (order.items && order.items.length > 0) {
        order.items.forEach(item => {
          if (item.product) {
            const productId = item.productId;
            if (!productSales[productId]) {
              productSales[productId] = {
                productId,
                name: item.product.name || 'Unknown Product',
                nameAr: item.product.nameAr,
                image: item.product.images?.[0]?.url || '/placeholder.svg',
                quantity: 0,
                revenue: 0,
                orderCount: 0
              };
            }
            const quantity = item.quantity || 0;
            const itemPrice = item.price || 0;
            productSales[productId].quantity += quantity;
            productSales[productId].revenue += itemPrice * quantity;
            productSales[productId].orderCount += 1;
          }
        });
      }
    });

    const topProducts = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    res.json({
      financial: {
        totalRevenue,
        totalNetProfit,
        stockValuation: {
          cost: stockValuationCost,
          retail: stockValuationRetail,
          potentialProfit: stockValuationRetail - stockValuationCost
        }
      },
      logistics: {
        deliverySuccessRate,
        yalidineLivreOrders,
        totalShipped
      },
      ordersByCity,
      topCategories,
      topProducts
    });
  } catch (error) {
    console.error('Comprehensive analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch comprehensive analytics' });
  }
});

// Time-Series Analytics (Last 30 days)
router.get('/analytics/time-series', async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    // Get all confirmed orders from last 30 days
    const orders = await prisma.order.findMany({
      where: {
        callCenterStatus: 'CONFIRMED',
        createdAt: {
          gte: thirtyDaysAgo
        }
      },
      include: {
        items: {
          include: {
            product: true
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    // Group by date
    const dailyData = {};

    // Initialize all 30 days
    for (let i = 0; i < 30; i++) {
      const date = new Date(thirtyDaysAgo);
      date.setDate(date.getDate() + i);
      const dateKey = date.toISOString().split('T')[0];
      dailyData[dateKey] = {
        date: dateKey,
        orders: 0,
        revenue: 0,
        profit: 0
      };
    }

    // Process orders
    orders.forEach(order => {
      if (order.createdAt) {
        const dateKey = order.createdAt.toISOString().split('T')[0];
        if (dailyData[dateKey]) {
          dailyData[dateKey].orders += 1;
          dailyData[dateKey].revenue += order.subtotal || 0;

          // Calculate profit for this order
          let orderProfit = 0;
          if (order.items && order.items.length > 0) {
            order.items.forEach(item => {
              if (item.product) {
                const itemPrice = item.price || 0;
                const costPrice = item.product.costPrice || 0;
                const quantity = item.quantity || 0;
                const profitPerUnit = itemPrice - costPrice;
                orderProfit += profitPerUnit * quantity;
              }
            });
          }
          dailyData[dateKey].profit += orderProfit;
        }
      }
    });

    // Convert to array and format dates
    const timeSeriesData = Object.values(dailyData).map(item => ({
      date: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      orders: item.orders,
      revenue: item.revenue,
      profit: item.profit
    }));

    res.json(timeSeriesData);
  } catch (error) {
    console.error('Time-series analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch time-series analytics' });
  }
});

// Orders Timeline Analytics - Confirmed Orders and New Orders by Time Period
router.get('/analytics/orders-timeline', async (req, res) => {
  try {
    const { period = 'days' } = req.query; // days, weeks, months

    let startDate = new Date();

    // Set start date based on period
    if (period === 'days') {
      startDate.setDate(startDate.getDate() - 30); // Last 30 days
    } else if (period === 'weeks') {
      startDate.setDate(startDate.getDate() - 84); // Last 12 weeks
    } else if (period === 'months') {
      startDate.setMonth(startDate.getMonth() - 12); // Last 12 months
    }

    startDate.setHours(0, 0, 0, 0);

    // Get all orders in the period
    const allOrders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: startDate
        }
      },
      select: {
        id: true,
        createdAt: true,
        callCenterStatus: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    // Helper function to get week number
    const getWeek = (date) => {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };

    // Group orders by date and status
    const timelineData = {};
    const dateLabels = [];

    // Initialize all periods
    const currentDate = new Date(startDate);
    const endDate = new Date();

    while (currentDate <= endDate) {
      let dateKey = '';
      let label = '';

      if (period === 'days') {
        dateKey = currentDate.toISOString().split('T')[0];
        label = currentDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        currentDate.setDate(currentDate.getDate() + 1);
      } else if (period === 'weeks') {
        const week = getWeek(currentDate);
        dateKey = `${currentDate.getFullYear()}-W${week.toString().padStart(2, '0')}`;
        label = `Sem ${week}`;
        currentDate.setDate(currentDate.getDate() + 7);
      } else if (period === 'months') {
        dateKey = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;
        label = currentDate.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      if (!timelineData[dateKey]) {
        timelineData[dateKey] = {
          date: dateKey,
          label: label,
          newOrders: 0,
          confirmedOrders: 0
        };
        dateLabels.push(dateKey);
      }
    }

    // Process orders
    allOrders.forEach(order => {
      let dateKey = '';
      if (period === 'days') {
        dateKey = order.createdAt.toISOString().split('T')[0];
      } else if (period === 'weeks') {
        const week = getWeek(order.createdAt);
        dateKey = `${order.createdAt.getFullYear()}-W${week.toString().padStart(2, '0')}`;
      } else if (period === 'months') {
        dateKey = `${order.createdAt.getFullYear()}-${(order.createdAt.getMonth() + 1).toString().padStart(2, '0')}`;
      }

      if (timelineData[dateKey]) {
        if (order.callCenterStatus === 'NEW') {
          timelineData[dateKey].newOrders += 1;
        } else if (order.callCenterStatus === 'CONFIRMED') {
          timelineData[dateKey].confirmedOrders += 1;
        }
      }
    });

    // Convert to array and calculate confirmation rate
    const result = dateLabels.map(key => {
      const data = timelineData[key];
      const total = data.newOrders + data.confirmedOrders;
      const confirmationRate = total > 0 ? ((data.confirmedOrders / total) * 100) : 0;

      return {
        ...data,
        totalOrders: total,
        confirmationRate: confirmationRate
      };
    });

    // Calculate overall stats
    const totalNewOrders = result.reduce((sum, item) => sum + item.newOrders, 0);
    const totalConfirmedOrders = result.reduce((sum, item) => sum + item.confirmedOrders, 0);
    const totalOrders = totalNewOrders + totalConfirmedOrders;
    const overallConfirmationRate = totalOrders > 0 ? ((totalConfirmedOrders / totalOrders) * 100) : 0;

    res.json({
      period,
      timeline: result,
      stats: {
        totalNewOrders,
        totalConfirmedOrders,
        totalOrders,
        overallConfirmationRate
      }
    });
  } catch (error) {
    console.error('Orders timeline analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch orders timeline analytics' });
  }
});

// Inventory Intelligence Endpoint
router.get('/analytics/inventory-intelligence', async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      include: {
        sizes: true,
        category: {
          select: {
            name: true,
            nameAr: true
          }
        },
        brand: {
          select: {
            name: true
          }
        },
        images: {
          where: {
            isPrimary: true
          },
          take: 1
        }
      }
    });

    const inventoryData = products.map(product => {
      // Stock = sum of sizes' stock if sizes exist, otherwise use product.stock
      // Don't add product.stock + sizes.stock (that would double count)
      let totalStock = 0;
      if (product.sizes && product.sizes.length > 0) {
        // If product has sizes, use sum of sizes' stock
        totalStock = product.sizes.reduce((sum, size) => sum + (size.stock || 0), 0);
      } else {
        // If product has no sizes, use product.stock
        totalStock = product.stock || 0;
      }
      const costPrice = product.costPrice || 0;
      const price = product.price || 0;
      const unitProfit = price - costPrice;
      const totalPotentialProfit = unitProfit * totalStock;
      const lowStockThreshold = 10; // Alert if stock < 10
      const isLowStock = totalStock < lowStockThreshold;

      // Check for low stock by size
      const lowStockSizes = (product.sizes || []).filter(size => (size.stock || 0) < lowStockThreshold);

      return {
        id: product.id,
        name: product.name || 'Unknown Product',
        nameAr: product.nameAr,
        categoryName: product.category?.name || 'Uncategorized',
        categoryNameAr: product.category?.nameAr,
        brandName: product.brand?.name || 'Unknown Brand',
        image: product.images?.[0]?.url || '/placeholder.svg',
        price: price,
        costPrice: costPrice,
        unitProfit,
        totalStock,
        totalPotentialProfit,
        stockValuationCost: costPrice * totalStock,
        stockValuationRetail: price * totalStock,
        profitMargin: price > 0 ? ((unitProfit / price) * 100) : 0,
        isLowStock,
        lowStockSizes: lowStockSizes.map(size => ({
          size: size.size || 'N/A',
          stock: size.stock || 0
        }))
      };
    });

    // Sort by total potential profit (descending)
    inventoryData.sort((a, b) => b.totalPotentialProfit - a.totalPotentialProfit);

    res.json(inventoryData);
  } catch (error) {
    console.error('Inventory intelligence error:', error);
    res.status(500).json({ error: 'Failed to fetch inventory intelligence' });
  }
});

module.exports = router;