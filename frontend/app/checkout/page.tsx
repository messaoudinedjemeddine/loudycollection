'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ShoppingCart,
  Truck,
  MapPin,
  Phone,
  User,
  CreditCard,
  Package,
  Check,
  Loader2,
  Trash2
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useCartStore } from '@/lib/store'
import { useLocaleStore } from '@/lib/locale-store'
import { api } from '@/lib/api'
import { yalidineAPI, type Wilaya, type Commune, type Center, type ShippingFees } from '@/lib/yalidine-api'
import { validatePhoneNumber, formatPhoneNumber } from '@/lib/validation'
import { toast } from 'sonner'

export default function CheckoutPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { items, getTotalPrice, clearCart, removeItem } = useCartStore()
  // Force RTL for this Arabic page or respect store? Start with store but text is Arabic.
  const { isRTL } = useLocaleStore()

  // Yalidine data states
  const [yalidineStatus, setYalidineStatus] = useState<{ configured: boolean; message: string } | null>(null)
  const [wilayas, setWilayas] = useState<Wilaya[]>([])
  const [communes, setCommunes] = useState<Commune[]>([])
  const [centers, setCenters] = useState<Center[]>([])
  const [shippingFees, setShippingFees] = useState<ShippingFees | null>(null)
  const [isLoadingShipping, setIsLoadingShipping] = useState(false)

  const [formData, setFormData] = useState<{
    customerName: string
    customerPhone: string
    customerInstagram: string
    deliveryType: 'HOME_DELIVERY' | 'PICKUP'
    wilayaId: string
    wilayaName: string
    communeId: string
    communeName: string
    centerId: string
    centerName: string
    deliveryAddress: string
    notes: string
  }>({
    customerName: '',
    customerPhone: '',
    customerInstagram: '',
    // customerEmail removed
    deliveryType: 'HOME_DELIVERY',
    wilayaId: '',
    wilayaName: '',
    communeId: '',
    communeName: '',
    centerId: '',
    centerName: '',
    deliveryAddress: '',
    notes: ''
  })

  // Validation errors
  const [validationErrors, setValidationErrors] = useState({
    customerPhone: '',
  })

  useEffect(() => {
    setMounted(true)
    loadYalidineData()
  }, [])


  // Load Yalidine data
  const loadYalidineData = async () => {
    try {
      // Check Yalidine status
      const status = await yalidineAPI.getStatus()
      setYalidineStatus(status)

      if (status.configured) {
        // Load wilayas
        const wilayasData = await yalidineAPI.getWilayas()
        if (wilayasData.data && wilayasData.data.length > 0) {
          setWilayas(wilayasData.data)
        } else {
          console.warn('No wilayas data received')
          toast.warning('Shipping fees not available, using default fees')
        }
      }
    } catch (error) {
      console.error('Failed to load Yalidine data:', error)
      toast.warning('Shipping fees not available, using default fees')
    }
  }

  // Load communes when wilaya changes
  const loadCommunes = async (wilayaId: string, deliveryType: 'HOME_DELIVERY' | 'PICKUP' = formData.deliveryType as 'HOME_DELIVERY' | 'PICKUP') => {
    if (!wilayaId) {
      setCommunes([])
      setCenters([])
      return
    }

    try {
      setIsLoadingShipping(true)
      
      // Always load centers first - we need them for PICKUP
      const centersData = await yalidineAPI.getCenters(parseInt(wilayaId))
      setCenters(centersData.data || [])

      // For PICKUP: derive communes from centers (only communes with desks)
      // For HOME_DELIVERY: load all communes from API
      if (deliveryType === 'PICKUP') {
        // Extract unique communes from centers
        const communesFromCenters = new Map<number, Commune>()
        centersData.data?.forEach((center) => {
          if (center.commune_id && !communesFromCenters.has(center.commune_id)) {
            communesFromCenters.set(center.commune_id, {
              id: center.commune_id,
              name: center.commune_name,
              wilaya_id: center.wilaya_id,
              wilaya_name: center.wilaya_name,
              has_stop_desk: true, // All communes from centers have desks
              is_deliverable: true,
              delivery_time_parcel: 0,
              delivery_time_payment: 0
            })
          }
        })
        setCommunes(Array.from(communesFromCenters.values()))
      } else {
        // For HOME_DELIVERY, load all communes from API
        const communesData = await yalidineAPI.getCommunes(parseInt(wilayaId))
        setCommunes(communesData.data || [])
      }

      // Calculate shipping fees
      await calculateShippingFees(parseInt(wilayaId))
    } catch (error) {
      console.error('Failed to load communes:', error)
      toast.error('فشل تحميل خيارات التوصيل')
    } finally {
      setIsLoadingShipping(false)
    }
  }

  // Calculate shipping fees
  const calculateShippingFees = async (toWilayaId: number) => {
    try {
      // Use Batna (5) as default from wilaya
      const fromWilayaId = 5

      // Calculate total weight and dimensions from cart items (using defaults if not available)
      const totalWeight = items.reduce((sum, item) => sum + 0.5, 0) // Default 0.5kg per item
      const totalLength = 30 // Default 30cm
      const totalWidth = 20 // Default 20cm
      const totalHeight = items.reduce((sum, item) => sum + 10, 0) // Default 10cm per item

      const fees = await yalidineAPI.calculateFees({
        fromWilayaId,
        toWilayaId,
        weight: totalWeight,
        length: totalLength,
        width: totalWidth,
        height: totalHeight,
        declaredValue: getTotalPrice()
      })

      console.log('Shipping fees calculated:', fees)
      setShippingFees(fees)
    } catch (error) {
      console.error('Failed to calculate shipping fees:', error)
      toast.error('فشل حساب رسوم الشحن. يرجى المحاولة مرة أخرى.')
      setShippingFees(null)
    }
  }

  if (!mounted) return null

  // Redirect if cart is empty
  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-background text-right" dir="rtl">
        <div className="pt-16 container mx-auto px-4 py-16 text-center">
          <div className="w-24 h-24 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
            <ShoppingCart className="w-12 h-12 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-bold mb-4">سلة التسوق فارغة</h2>
          <p className="text-muted-foreground mb-8">أضف بعض المنتجات للمتابعة إلى الدفع</p>
          <Button asChild>
            <Link href="/loud-styles/products">متابعة التسوق</Link>
          </Button>
        </div>
      </div>
    )
  }

  const selectedCenter = centers.find(c => c.center_id.toString() === formData.centerId)

  // Calculate delivery fee based on Yalidine data
  const getDeliveryFee = () => {
    if (!shippingFees) {
      // Fallback to default delivery fees if shipping fees not available
      console.warn('Shipping fees not available, using default fees');
      return formData.deliveryType === 'HOME_DELIVERY' ? 500 : 0;
    }

    try {
      if (formData.deliveryType === 'HOME_DELIVERY') {
        return shippingFees.deliveryOptions?.express?.home || 500; // Fallback to 500 if not available
      } else {
        return shippingFees.deliveryOptions?.express?.desk || 0;
      }
    } catch (error) {
      console.error('Error calculating delivery fee:', error)
      return formData.deliveryType === 'HOME_DELIVERY' ? 500 : 0; // Fallback to default
    }
  }

  const deliveryFee = getDeliveryFee()
  const subtotal = getTotalPrice()
  const total = subtotal + deliveryFee

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => {
      const updates: any = { [field]: value };

      // When delivery type changes, reset delivery-specific fields
      if (field === 'deliveryType') {
        if (value === 'HOME_DELIVERY') {
          // Reset center selection for home delivery
          updates.centerId = '';
          updates.centerName = '';
        } else if (value === 'PICKUP') {
          // Reset address for pickup
          updates.deliveryAddress = '';
          // Reset commune and center - will reload based on centers
          updates.communeId = '';
          updates.communeName = '';
          updates.centerId = '';
          updates.centerName = '';
        }
      }

      // Update names when IDs change
      if (field === 'wilayaId') {
        const wilaya = wilayas.find(w => w.id.toString() === value);
        updates.wilayaName = wilaya ? wilaya.name : '';
        // Reset sub-selections
        updates.communeId = '';
        updates.communeName = '';
        updates.centerId = '';
        updates.centerName = '';
      }

      if (field === 'communeId') {
        const commune = communes.find(c => c.id.toString() === value);
        updates.communeName = commune ? commune.name : '';
        // Reset center selection when commune changes
        updates.centerId = '';
        updates.centerName = '';
      }

      if (field === 'centerId') {
        const center = centers.find(c => c.center_id.toString() === value);
        updates.centerName = center ? center.name : '';
      }

      return { ...prev, ...updates };
    });

    // Clear validation error when user starts typing
    if (field === 'customerPhone') {
      setValidationErrors(prev => ({
        ...prev,
        [field]: ''
      }))
    }

    // Handle wilaya change side effects (loading data)
    if (field === 'wilayaId') {
      loadCommunes(value, formData.deliveryType)
    }

    // When delivery type changes, reload communes to get the right list
    if (field === 'deliveryType' && formData.wilayaId) {
      // Reload communes based on new delivery type
      loadCommunes(formData.wilayaId, value as 'HOME_DELIVERY' | 'PICKUP')
    }
  }

  const validateForm = (): boolean => {
    let isValid = true
    const errors = { customerPhone: '' }

    // Validate required fields
    if (!formData.customerName) {
      toast.error('يرجى إدخال الاسم الكامل')
      return false
    }
    if (!formData.customerPhone) {
      toast.error('يرجى إدخال رقم الهاتف')
      return false
    }
    if (!formData.wilayaId) {
      toast.error('يرجى اختيار الولاية')
      return false
    }
    if (formData.deliveryType === 'HOME_DELIVERY') {
      if (!formData.communeId) {
        toast.error('يرجى اختيار البلدية')
        return false
      }
      if (!formData.deliveryAddress) {
        toast.error('يرجى إدخال عنوان التوصيل')
        return false
      }
    }
    if (formData.deliveryType === 'PICKUP') {
      if (!formData.communeId) {
        toast.error('يرجى اختيار البلدية')
        return false
      }
      if (!formData.centerId) {
        toast.error('يرجى اختيار مكتب التوصيل')
        return false
      }
    }

    // Validate phone number
    const phoneValidation = validatePhoneNumber(formData.customerPhone)
    if (!phoneValidation.isValid) {
      errors.customerPhone = 'رقم الهاتف غير صالح' // Arabic error message
      isValid = false
    }

    setValidationErrors(errors)
    return isValid
  }

  const handleSubmitOrder = async () => {
    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)

    try {
      // Get selected center info for pickup orders
      const selectedCenter = centers.find(c => c.center_id.toString() === formData.centerId);

      // Prepare order data
      const orderData = {
        customerName: formData.customerName,
        customerPhone: formData.customerPhone,
        customerInstagram: formData.customerInstagram || undefined,
        // customerEmail removed
        deliveryType: formData.deliveryType as 'HOME_DELIVERY' | 'PICKUP',
        deliveryAddress: formData.deliveryType === 'HOME_DELIVERY' ? formData.deliveryAddress : undefined,
        wilayaId: parseInt(formData.wilayaId),
        deliveryDeskId: formData.deliveryType === 'PICKUP' && formData.centerId ? formData.centerId : undefined,
        deliveryDeskName: formData.deliveryType === 'PICKUP' && selectedCenter ? selectedCenter.name : undefined,
        deliveryFee: deliveryFee > 0 ? deliveryFee : undefined,
        notes: formData.notes || undefined,
        items: items.map(item => ({
          productId: item.id,
          quantity: item.quantity,
          sizeId: item.sizeId,
          size: item.size // Send size string as fallback
        })),
        // Add detailed delivery info details from formData
        communeId: formData.communeId || undefined,
        communeName: formData.communeName || undefined,
        wilayaName: formData.wilayaName || undefined,
        // centerId sent as deliveryDeskId for backward compatibility in logic but backend now reads it for details
      }

      // Create order via API
      const response = await api.orders.create(orderData) as { order: { orderNumber: string } }

      // Prepare order details for success page
      const orderDetails = {
        orderNumber: response.order.orderNumber,
        customerName: formData.customerName,
        customerPhone: formData.customerPhone,
        customerEmail: '',
        deliveryType: formData.deliveryType,
        deliveryAddress: formData.deliveryType === 'HOME_DELIVERY' ? formData.deliveryAddress : '',
        wilayaId: parseInt(formData.wilayaId),
        deliveryDeskName: formData.deliveryType === 'PICKUP' && selectedCenter ? selectedCenter.name : '',
        notes: formData.notes || '',
        items: items.map(item => ({
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          size: item.size,
          image: item.image || '/placeholder.svg' // Ensure image is always a valid string
        })),
        subtotal: getTotalPrice(),
        deliveryFee: getDeliveryFee(),
        total: getTotalPrice() + getDeliveryFee(),
        orderDate: new Date().toISOString()
      }

      // Store order details in localStorage for the success page
      localStorage.setItem('lastOrderDetails', JSON.stringify(orderDetails))

      // Clear cart
      clearCart()

      // Redirect to success page with order number
      router.push(`/order-success?orderNumber=${response.order.orderNumber}`)

      toast.success('تم إنشاء الطلب بنجاح!')
    } catch (error) {
      console.error('Order creation failed:', error)
      toast.error('فشل إنشاء الطلب. يرجى المحاولة مرة أخرى.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="pt-16">
        {/* Header */}
        <div className="bg-gradient-to-l from-primary/10 via-primary/5 to-secondary/10 dark:from-primary/20 dark:via-primary/10 dark:to-secondary/20">
          <div className="container mx-auto px-4 py-12">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-center"
            >
              <h1 className="text-3xl md:text-5xl font-bold mb-4 font-heading">
                إتمام الطلب
              </h1>
              <p className="text-lg text-muted-foreground">
                أكمل طلبك بسهولة وأمان
              </p>
            </motion.div>
          </div>
        </div>

        {/* Checkout Form */}
        <div className="container mx-auto px-4 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">

              {/* Customer Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5 text-primary" />
                    معلومات العميل
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="customerName">الاسم الكامل *</Label>
                      <Input
                        id="customerName"
                        value={formData.customerName}
                        onChange={(e) => handleInputChange('customerName', e.target.value)}
                        placeholder="الاسم واللقب"
                        className="text-right"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="customerPhone">رقم الهاتف *</Label>
                      <Input
                        id="customerPhone"
                        value={formData.customerPhone}
                        onChange={(e) => handleInputChange('customerPhone', e.target.value)}
                        placeholder="06XXXXXXXX, 05XXXXXXXX"
                        className={`text-right ${validationErrors.customerPhone ? 'border-red-500' : ''}`}
                        dir="ltr"
                        required
                      />
                      {validationErrors.customerPhone && (
                        <p className="text-red-500 text-sm mt-1">{validationErrors.customerPhone}</p>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="customerInstagram">حساب الإنستغرام (اختياري)</Label>
                      <Input
                        id="customerInstagram"
                        value={formData.customerInstagram}
                        onChange={(e) => handleInputChange('customerInstagram', e.target.value)}
                        placeholder="@username"
                        className="text-right"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Delivery Options */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Truck className="w-5 h-5 text-primary" />
                    خيارات التوصيل
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Delivery Type */}
                  <div>
                    <Label className="text-base font-medium mb-3 block">نوع التوصيل</Label>
                    <RadioGroup
                      value={formData.deliveryType}
                      onValueChange={(value: string) => handleInputChange('deliveryType', value)}
                      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                    >
                      <div className={`flex items-center space-x-2 space-x-reverse border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors ${formData.deliveryType === 'HOME_DELIVERY' ? 'border-primary bg-primary/5' : ''}`}>
                        <RadioGroupItem value="HOME_DELIVERY" id="home" />
                        <Label htmlFor="home" className="flex items-center cursor-pointer w-full mr-2">
                          <Truck className="w-4 h-4 ml-2" />
                          توصيل للمنزل
                        </Label>
                      </div>
                      <div className={`flex items-center space-x-2 space-x-reverse border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors ${formData.deliveryType === 'PICKUP' ? 'border-primary bg-primary/5' : ''}`}>
                        <RadioGroupItem value="PICKUP" id="pickup" />
                        <Label htmlFor="pickup" className="flex items-center cursor-pointer w-full mr-2">
                          <Package className="w-4 h-4 ml-2" />
                          استلام من المكتب
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Wilaya Selection */}
                    <div>
                      <Label htmlFor="wilaya">الولاية *</Label>
                      <Select value={formData.wilayaId} onValueChange={(value) => handleInputChange('wilayaId', value)}>
                        <SelectTrigger className="h-12 text-base md:h-10 md:text-sm">
                          <SelectValue placeholder="اختر الولاية" className="[&>span]:text-left [&>span]:dir-ltr" />
                        </SelectTrigger>
                        <SelectContent dir="ltr" className="max-h-[300px]">
                          {yalidineStatus === null ? (
                            <div className="flex items-center justify-center p-4" dir="rtl">
                              <Loader2 className="w-4 h-4 animate-spin ml-2" />
                              جاري التحميل...
                            </div>
                          ) : !yalidineStatus.configured ? (
                            <div className="p-4 text-center text-muted-foreground" dir="rtl">
                              خدمة الشحن غير متوفرة
                            </div>
                          ) : (
                            wilayas.map((wilaya) => (
                              <SelectItem 
                                key={wilaya.id} 
                                value={wilaya.id.toString()}
                                className="text-left py-3 text-base md:py-2 md:text-sm"
                              >
                                {wilaya.id} - {wilaya.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Commune Selection - Show for both Home Delivery and Pickup */}
                    {formData.wilayaId && (
                      <div>
                        <Label htmlFor="commune">البلدية *</Label>
                        <Select value={formData.communeId} onValueChange={(value) => handleInputChange('communeId', value)}>
                          <SelectTrigger className="h-12 text-base md:h-10 md:text-sm">
                            <SelectValue placeholder={formData.deliveryType === 'PICKUP' ? "اختر البلدية (التي بها مكتب)" : "اختر البلدية"} className="[&>span]:text-left [&>span]:dir-ltr" />
                          </SelectTrigger>
                          <SelectContent dir="ltr" className="max-h-[300px]">
                            {isLoadingShipping ? (
                              <div className="flex items-center justify-center p-4" dir="rtl">
                                <Loader2 className="w-4 h-4 animate-spin ml-2" />
                                تحمبل...
                              </div>
                            ) : (
                              communes
                                // For PICKUP, communes are already filtered from centers
                                // For HOME_DELIVERY, show all communes
                                .map((commune) => (
                                  <SelectItem 
                                    key={commune.id} 
                                    value={commune.id.toString()}
                                    className="text-left py-3 text-base md:py-2 md:text-sm"
                                  >
                                    {commune.name}
                                  </SelectItem>
                                ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  {/* Center Selection (Pickup Only) - Show after commune is selected */}
                  {formData.deliveryType === 'PICKUP' && formData.wilayaId && formData.communeId && (
                    <div>
                      <Label htmlFor="center">مكتب الاستلام *</Label>
                      <Select value={formData.centerId} onValueChange={(value) => handleInputChange('centerId', value)}>
                        <SelectTrigger className="h-12 text-base md:h-10 md:text-sm">
                          <SelectValue placeholder="اختر مكتب ياليدين" className="[&>span]:text-left [&>span]:dir-ltr" />
                        </SelectTrigger>
                        <SelectContent dir="ltr" className="max-h-[300px]">
                          {isLoadingShipping ? (
                            <div className="flex items-center justify-center p-4" dir="rtl">
                              <Loader2 className="w-4 h-4 animate-spin ml-2" />
                              تحميل المكاتب...
                            </div>
                          ) : (
                            centers
                              .filter(center => {
                                // Filter by wilaya and commune
                                return center.wilaya_id.toString() === formData.wilayaId &&
                                       center.commune_id.toString() === formData.communeId
                              })
                              .map((center) => (
                                <SelectItem 
                                  key={center.center_id} 
                                  value={center.center_id.toString()}
                                  className="text-left py-3 text-base md:py-2 md:text-sm"
                                >
                                  {center.name} - {center.address}
                                </SelectItem>
                              ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Home Delivery Address */}
                  {formData.deliveryType === 'HOME_DELIVERY' && (
                    <div>
                      <Label htmlFor="address">العنوان الكامل *</Label>
                      <Textarea
                        id="address"
                        value={formData.deliveryAddress}
                        onChange={(e) => handleInputChange('deliveryAddress', e.target.value)}
                        placeholder="الحي، رقم المنزل، الشارع..."
                        className="text-right"
                        rows={3}
                      />
                    </div>
                  )}

                  {/* Shipping Fees Display */}
                  {shippingFees && (
                    <Card className="bg-muted/50 border-dashed">
                      <CardContent className="p-4 space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-green-600 font-bold">رسوم التوصيل:</span>
                          <span className="font-bold text-green-600">
                            {getDeliveryFee().toLocaleString()} د.ج
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formData.deliveryType === 'HOME_DELIVERY' ? 'توصيل للمنزل' : 'استلام من المكتب'}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Notes */}
                  <div>
                    <Label htmlFor="notes">ملاحظات (اختياري)</Label>
                    <Textarea
                      id="notes"
                      value={formData.notes}
                      onChange={(e) => handleInputChange('notes', e.target.value)}
                      placeholder="أي تعليمات خاصة للتوصيل..."
                      className="text-right"
                      rows={2}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Order Summary Sidebar */}
            <div className="lg:col-span-1">
              <div className="sticky top-24 space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ShoppingCart className="w-5 h-5 text-primary" />
                      ملخص الطلب
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Cart Items */}
                    <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                      {items.map((item) => (
                        <div key={`${item.id}-${item.sizeId || 'no-size'}`} className="flex items-center space-x-3 space-x-reverse group bg-background/50 hover:bg-background/80 p-2 rounded-lg transition-colors">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500 hover:bg-red-50 hover:text-red-700"
                            onClick={() => removeItem(item.id, item.sizeId)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <div className="relative w-12 h-12 bg-muted rounded-md overflow-hidden flex-shrink-0">
                            <Image
                              src={item.image}
                              alt={item.name}
                              fill
                              className="object-cover"
                              unoptimized={item.image?.startsWith('http')}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate text-right">{item.name}</p>
                            {item.size && (
                              <p className="text-xs text-muted-foreground text-right">المقاس: {item.size}</p>
                            )}
                            <p className="text-sm text-right text-muted-foreground">
                              {item.quantity} × {item.price.toLocaleString()} د.ج
                            </p>
                          </div>
                          <p className="font-medium text-sm">
                            {(item.quantity * item.price).toLocaleString()} د.ج
                          </p>
                        </div>
                      ))}
                    </div>

                    <Separator />

                    {/* Price Breakdown */}
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>المجموع الفرعي:</span>
                        <span>{subtotal.toLocaleString()} د.ج</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span className="text-green-600 font-medium">سعر التوصيل:</span>
                        <span className="text-green-600 font-medium">{deliveryFee > 0 ? `${deliveryFee.toLocaleString()} د.ج` : '-'}</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between font-bold text-lg">
                        <span>الإجمالي:</span>
                        <span className="text-primary">{total.toLocaleString()} د.ج</span>
                      </div>
                    </div>

                    {/* Submit Button */}
                    <Button
                      className="w-full text-lg py-6 mt-4"
                      onClick={handleSubmitOrder}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin ml-2" />
                          جاري الطلب...
                        </>
                      ) : (
                        <>
                          <Check className="w-5 h-5 ml-2" />
                          تأكيد الطلب
                        </>
                      )}
                    </Button>

                    <p className="text-xs text-center text-muted-foreground mt-2">
                      بالنقر على تأكيد الطلب، فإنك توافق على شروط الخدمة وسياسة الخصوصية.
                    </p>
                  </CardContent>
                </Card>

                {/* Method of Payment Note */}
                <Card className="bg-primary/5 border-primary/20">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="bg-primary/10 p-2 rounded-full">
                      <CreditCard className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">الدفع عند الاستلام</p>
                      <p className="text-xs text-muted-foreground">ادفع نقدًا عند استلام طلبك</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}