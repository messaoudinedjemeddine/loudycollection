'use client'

import { Preloader } from '@/components/preloader'
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
// Tree-shakeable: only import what we need from framer-motion
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ShoppingCart,
  Heart,
  Star,
  ChevronLeft,
  ChevronRight,
  Truck,
  Shield,
  RotateCcw,
  Plus,
  Minus,
  Check,
  Sparkles,
  TrendingUp,
  X,
  ArrowLeft,
  ZoomIn,
  MessageCircle
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { OptimizedImage } from '@/components/performance/optimized-image'
import { useCartStore, useWishlistStore, useUIStore } from '@/lib/store'
import { useLocaleStore } from '@/lib/locale-store'
import { toast } from 'sonner'
import { LoudStylesNavbar } from '@/components/loud-styles-navbar'
// Lazy load non-critical components
const LaunchCountdownEnhanced = dynamic(() => import('@/components/launch-countdown-enhanced').then(mod => ({ default: mod.LaunchCountdownEnhanced })), {
  ssr: false
})

declare global {
  interface Window {
    fbq: any;
    gtag: any;
  }
}

interface Product {
  id: string;
  name: string;
  nameAr?: string;
  description?: string;
  descriptionAr?: string;
  price: number;
  oldPrice?: number;
  category: {
    id: string;
    name: string;
    nameAr?: string;
    slug: string;
  };
  rating?: number;
  reviewCount?: number;
  isOnSale?: boolean;
  isLaunch?: boolean;
  isOutOfStock?: boolean;
  stock: number;
  reference?: string;
  images: string[];
  sizes: Array<{ id: string; size: string; stock: number }>;
  slug?: string;
  launchAt?: string;
  isLaunchActive?: boolean;
}

interface LuxuryProductDetailProps {
  product: Product
}

export default function LuxuryProductDetail({ product }: LuxuryProductDetailProps) {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [selectedSize, setSelectedSize] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [showImageModal, setShowImageModal] = useState(false)
  const [timerCompleted, setTimerCompleted] = useState(false)
  const [showAccessoryPopup, setShowAccessoryPopup] = useState(false)
  const [accessoryPopupDismissed, setAccessoryPopupDismissed] = useState(false)
  const [showSizeGuide, setShowSizeGuide] = useState(false)
  const [relatedAccessories, setRelatedAccessories] = useState<Product[]>([])
  const [loadingAccessories, setLoadingAccessories] = useState(false)
  const [colorVariants, setColorVariants] = useState<Array<{ slug: string; color: string; name: string; nameEn: string; hexColor: string; isCurrent: boolean }>>([])
  const isOrderable = (!product?.isLaunchActive || timerCompleted) && !product?.isOutOfStock

  const addItem = useCartStore((state) => state.addItem)
  const { addToWishlist, removeFromWishlist, isInWishlist } = useWishlistStore()
  const { isRTL } = useLocaleStore()
  const { setCartOpen } = useUIStore()

  const [isMobile, setIsMobile] = useState(false)

  // Check if product is in accessoires category
  const categorySlug = product?.category?.slug?.toLowerCase() || '';
  const isAccessoires = categorySlug.includes('accessoire') || categorySlug.includes('accessories');
  const isShoes = categorySlug.includes('shoe') || categorySlug.includes('chaussure') || product?.category?.name?.toLowerCase().includes('shoe') || product?.category?.name?.toLowerCase().includes('chaussure');

  // All hooks must be called before any conditional returns
  useEffect(() => {
    setMounted(true)

    // Check if mobile
    if (typeof window !== 'undefined') {
      const checkMobile = () => {
        setIsMobile(window.innerWidth < 768)
      }
      checkMobile()
      window.addEventListener('resize', checkMobile)
      return () => window.removeEventListener('resize', checkMobile)
    }

    return () => { } // Return empty cleanup function if window is undefined
  }, [product])

  useEffect(() => {
    // Auto-select first size if available (only for non-accessoires)
    if (!isAccessoires && product?.sizes && product.sizes.length > 0 && !selectedSize) {
      const firstSize = product.sizes.find(s => {
        const size = typeof s === 'string' ? s : s.size;
        // For shoes, accept any size. For regular products, skip 'S'
        if (isShoes) return true;
        return size !== 'S';
      });
      if (firstSize) {
        setSelectedSize(typeof firstSize === 'string' ? firstSize : firstSize.size)
      }
    }
  }, [product?.sizes, selectedSize, isAccessoires, isShoes])

  // Fetch true color variants dynamically
  useEffect(() => {
    if (!product?.name || !mounted) return;

    const fetchSiblingProducts = async () => {
      try {
        const colorKeywords = [
          'Aubergine/Beige', 'Noir/Rouge', 'Rose/Gris',
          'Bleu Turquoise', 'Vert Émreraude', 'Vert Bouteille', 'Blanc Casse',
          'Rouge Brique', 'Bleu Fayrouz', 'Blue Fayrouz', 'Vert Olive',
          'Vert D\'Eau', 'Royal Blue', 'Bleu Nuit', 'Blue Nuit', 'Bleu Roi', 'Blue Roi', 'Vert Kaki',
          'Fayrouzi', 'Aubergine', 'Pistache', 'Bordeaux', 'Bordeau',
          'Orange', 'Marron', 'Maron', 'Blanc', 'Rouge', 'Beige', 'Noir', 'Noire', 'Black', 'Bleu', 'Blue',
          'Rose', 'Vert', 'Gris'
        ];

        const colorHexMap: Record<string, string> = {
          'Noir': '#000000',
          'Black': '#000000',
          'Bleu': '#0000FF',
          'Blue': '#0000FF',
          'Blanc': '#FFFFFF',
          'Blanc Casse': '#FDFBF7',
          'White': '#FFFFFF',
          'Rose': '#FFC0CB',
          'Rouge': '#FF0000',
          'Red': '#FF0000',
          'Rouge Brique': '#CB4154',
          'Vert': '#008000',
          'Beige': '#F5F5DC',
          'Bordeaux': '#800000',
          'Bordeau': '#800000',
          'Gris': '#808080',
          'Marron': '#A52A2A',
          'Maron': '#A52A2A',
          'Fayrouzi': '#40E0D0',
          'Aubergine': '#4A0E4E',
          'Pistache': '#93C572',
          'Orange': '#FFA500',
          'Bleu Roi': '#4169E1',
          'Blue Roi': '#4169E1',
          'Royal Blue': '#4169E1',
          'Bleu Nuit': '#191970',
          'Blue Nuit': '#191970',
          'Bleu Fayrouz': '#00CED1',
          'Blue Fayrouz': '#00CED1',
          'Bleu Turquoise': '#40E0D0',
          'Vert Olive': '#808000',
          'Vert D\'Eau': '#B0E0E6',
          'Vert Kaki': '#C3B091',
          'Vert Émreraude': '#50C878',
          'Vert Bouteille': '#006A4E',
          'Aubergine/Beige': '#7B3F00',
          'Noir/Rouge': '#800020',
          'Rose/Gris': '#C0C0C0',
          'Noire': '#000000'
        };

        const extractColorFromName = (name: string): string | null => {
          if (!name) return null;
          for (const color of colorKeywords) {
            const regex = new RegExp(`\\s+${color.replace(/\//g, '\\/')}\\s*$`, 'i');
            if (regex.test(name)) {
              return color;
            }
          }
          return null;
        };

        const extractBaseName = (name: string): string => {
          if (!name) return '';
          let baseName = name.trim();
          for (const color of colorKeywords) {
            const regex = new RegExp(`\\s+${color.replace(/\//g, '\\/')}\\s*$`, 'i');
            if (regex.test(baseName)) {
              baseName = baseName.replace(regex, '').trim();
              break;
            }
          }
          return baseName;
        };

        const baseName = extractBaseName(product.name);

        // If no color suffix is found, return early
        if (baseName === product.name) {
          setColorVariants([]);
          return;
        }

        // Fetch enough products to find siblings
        const res = await fetch('/api/products?brand=loud-styles&limit=500', { cache: 'no-store' });
        if (!res.ok) return;

        const data = await res.json();
        const allProducts: Product[] = Array.isArray(data) ? data : (data.products || []);

        const siblings = allProducts.filter(p => p.name && extractBaseName(p.name) === baseName);

        if (siblings.length <= 1) {
          setColorVariants([]);
          return;
        }

        // Sort siblings alphabetically by color for a stable UI
        const sortedSiblings = siblings.sort((a, b) => a.name.localeCompare(b.name));

        const variants = sortedSiblings.map(sibling => {
          const colorName = extractColorFromName(sibling.name) || 'Default';
          return {
            slug: sibling.slug || sibling.name.toLowerCase().replace(/\s+/g, '-'),
            color: colorName.toLowerCase(),
            name: colorName, // Use the Arabic translation dictionary here if you add one later
            nameEn: colorName,
            hexColor: colorHexMap[colorName] || '#CCCCCC',
            isCurrent: sibling.id === product.id
          };
        });

        setColorVariants(variants);
      } catch (err) {
        console.error("Failed to fetch sibling products for color variants:", err);
      }
    };

    fetchSiblingProducts();
  }, [product?.name, product?.id, mounted]);

  // Fetch related accessories for yennayer-dress
  useEffect(() => {
    const isYennayerDress = product?.slug === 'yennayer-dress'

    if (isYennayerDress && mounted) {
      const fetchAccessories = async () => {
        setLoadingAccessories(true)
        const accessorySlugs = ['pack-yennayer', 'accessoires-yennayer', 'djbine-yennayer']

        try {
          const accessoriesPromises = accessorySlugs.map(async (slug) => {
            try {
              const res = await fetch(`/api/products/slug/${slug}?brand=loud-styles`, { cache: 'no-store' })
              if (res.ok) {
                const data = await res.json()
                return data.product
              }
              return null
            } catch (error) {
              console.error(`Error fetching ${slug}:`, error)
              return null
            }
          })

          const accessories = (await Promise.all(accessoriesPromises)).filter(Boolean)
          setRelatedAccessories(accessories)

          // Show popup after 3 seconds if accessories are loaded and not dismissed in this session
          if (accessories.length > 0 && !accessoryPopupDismissed) {
            const timer = setTimeout(() => {
              setShowAccessoryPopup(true)
            }, 3000)

            return () => clearTimeout(timer)
          }
        } catch (error) {
          console.error('Error fetching accessories:', error)
        } finally {
          setLoadingAccessories(false)
        }
      }

      fetchAccessories()
    }
  }, [product?.slug, mounted])

  // Handle adding accessory to cart
  const handleAddAccessoryToCart = (accessory: Product) => {
    const categorySlug = accessory?.category?.slug?.toLowerCase() || '';
    const isAccessoryAccessoires = categorySlug.includes('accessoire') || categorySlug.includes('accessories');

    addItem({
      id: accessory.id,
      name: isRTL ? accessory.nameAr || accessory.name : accessory.name,
      price: accessory.price,
      image: accessory.images[0],
      size: isAccessoryAccessoires ? undefined : undefined,
      sizeId: undefined,
      quantity: 1
    })

    if (window.gtag) {
      window.gtag('event', 'add_to_cart', {
        currency: 'DZD',
        value: accessory.price,
        items: [{
          item_id: accessory.id,
          item_name: accessory.name,
          price: accessory.price
        }]
      })
    }

    setCartOpen(true)
    toast.success(isRTL ? 'تمت الإضافة إلى السلة' : 'Added to cart', {
      className: 'bg-green-500 text-white border-green-600',
      icon: <Check className="w-4 h-4 text-white" />
    })
  }



  // Safety check for product - AFTER all hooks but before conditional return
  if (!product || !product.images || product.images.length === 0) {
    if (!mounted) return null
    return (
      <div className="min-h-screen bg-gradient-to-br from-cream-50 via-warm-50 to-cream-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Product data is missing or invalid</p>
        </div>
      </div>
    );
  }

  // inside component
  if (!mounted) {
    return <Preloader />
  }

  const nextImage = () => {
    setCurrentImageIndex((prev) =>
      prev === product.images.length - 1 ? 0 : prev + 1
    )
  }

  const prevImage = () => {
    setCurrentImageIndex((prev) =>
      prev === 0 ? product.images.length - 1 : prev - 1
    )
  }

  const handleAddToCart = () => {
    // Check if product is out of stock
    if (product.isOutOfStock) {
      toast.error(isRTL ? 'هذا المنتج غير متوفر' : 'This product is out of stock')
      return
    }

    // Check if product is in launch mode and countdown hasn't finished
    if (!isOrderable) {
      toast.error(isRTL ? 'يرجى الانتظار حتى انتهاء العد التنازلي' : 'Please wait for the countdown to finish')
      return
    }

    // Only require size if product has sizes and is not accessoires
    if (!isAccessoires && !selectedSize && product.sizes && product.sizes.length > 0) {
      toast.error(isRTL ? 'يرجى اختيار المقاس' : 'Please select a size')
      return
    }

    // Find the correct size object from the product.sizes array based on the selected string
    const selectedSizeObj = getSelectedSizeObject(selectedSize);

    addItem({
      id: product.id,
      name: isRTL ? product.nameAr || product.name : product.name,
      price: product.price,
      image: product.images[0],
      size: isAccessoires ? undefined : (selectedSize || undefined),
      sizeId: isAccessoires ? undefined : selectedSizeObj?.id,
      quantity: quantity
    })

    if (window.gtag) {
      window.gtag('event', 'add_to_cart', {
        currency: 'DZD',
        value: product.price,
        items: [{
          item_id: product.id,
          item_name: product.name,
          price: product.price,
          item_variant: selectedSize
        }]
      })
    }

    setCartOpen(true)

    toast.success(isRTL ? 'تمت الإضافة إلى السلة' : 'Added to cart', {
      className: 'bg-green-500 text-white border-green-600',
      icon: <Check className="w-4 h-4 text-white" />
    })
  }

  const handleWishlistToggle = () => {
    const isCurrentlyWishlisted = isInWishlist(product.id)

    if (isCurrentlyWishlisted) {
      removeFromWishlist(product.id)
      toast.success(isRTL ? 'تم الإزالة من المفضلة' : 'Removed from wishlist')
    } else {
      addToWishlist({
        id: product.id,
        name: product.name,
        nameAr: product.nameAr,
        price: product.price,
        oldPrice: product.oldPrice,
        image: product.images[0],
        rating: product.rating,
        isOnSale: product.isOnSale,
        stock: product.stock,
        slug: product.slug || product.name.toLowerCase().replace(/\s+/g, '-')
      })
      toast.success(isRTL ? 'تمت الإضافة إلى المفضلة' : 'Added to wishlist')
    }
  }

  const getSizeStrings = (sizes: any[]) => {
    if (!Array.isArray(sizes)) return []
    return sizes.map(size => typeof size === 'string' ? size : size.size)
  }

  const sizeStrings = getSizeStrings(product.sizes || [])

  // Size mapping for display
  const sizeMapping = {
    'M': '36-38',
    'L': '40',
    'XL': '42-44',
    'XXL': '46-48',
    'XXXL': '50-52'
  }

  // Helper to find the correct size object from the displayed size
  const getSelectedSizeObject = (displaySize: string | null) => {
    if (!displaySize || !product.sizes) return undefined;

    // First try exact match
    let match = product.sizes.find(s => s.size === displaySize);
    if (match) return match;

    // Try finding by numeric map
    const numericMatch = product.sizes.find(s => {
      const num = parseInt(s.size);
      if (isNaN(num)) return false;

      if (displaySize === 'M' && (num === 36 || num === 38)) return true;
      if (displaySize === 'L' && num === 40) return true;
      if (displaySize === 'XL' && (num >= 42 && num <= 44)) return true;
      if (displaySize === 'XXL' && (num >= 46 && num <= 48)) return true;
      if (displaySize === 'XXXL' && (num >= 50 && num <= 52)) return true;

      return false;
    });

    return numericMatch;
  }

  const getDisplaySizes = () => {
    // Don't show sizes for accessoires
    if (isAccessoires) return [];
    // Return shoe sizes if it's a shoe category
    if (isShoes) {
      // Get actual sizes from product or return default shoe sizes
      const actualSizes = getSizeStrings(product.sizes || []);
      if (actualSizes.length > 0) {
        // Sort numerically
        return actualSizes.sort((a, b) => {
          const numA = parseInt(a) || 0;
          const numB = parseInt(b) || 0;
          return numA - numB;
        });
      }
      return ['36', '37', '38', '39', '40', '41'];
    }
    // Return all standard sizes regardless of availability
    return ['M', 'L', 'XL', 'XXL', 'XXXL'];
  }

  const displaySizes = getDisplaySizes();

  // Optimize animations for mobile - reduce complexity (moved before conditional returns)
  // Disable animations for first image to improve LCP
  const containerVariants = {
    hidden: { opacity: 1 }, // Start visible to prevent delay
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0,
        delayChildren: 0
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 1, y: 0 }, // Start visible
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0,
        ease: [0.25, 0.46, 0.45, 0.94] as const
      }
    }
  };

  return (
    <React.Fragment>
      <LoudStylesNavbar />
      <div
        className="min-h-screen bg-gradient-to-br from-cream-50 via-warm-50 to-cream-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-x-hidden w-full max-w-[100vw]"
        dir={isRTL ? 'rtl' : 'ltr'}
        style={{ minHeight: '100vh' }}
      >
        {/* Header with Back Button */}
        <motion.div
          className="sticky top-0 z-40 bg-background/95 dark:bg-gray-900/95 backdrop-blur-md border-b border-border dark:border-gray-700"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: mounted && isMobile ? 0.2 : 0.5 }}
          style={{ minHeight: '60px' }}
        >
          <div className="container mx-auto px-3 sm:px-4 py-2.5 sm:py-4">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.back()}
                className="text-muted-foreground hover:text-foreground dark:text-gray-300 dark:hover:text-white h-8 sm:h-9 px-2 sm:px-3"
              >
                <ArrowLeft className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isRTL ? 'rotate-180' : ''}`} />
                <span className="ml-1.5 sm:ml-2 text-xs sm:text-sm">{isRTL ? 'العودة' : 'Back'}</span>
              </Button>

              <div className="flex items-center space-x-2 sm:space-x-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleWishlistToggle}
                  className={`text-muted-foreground hover:text-foreground dark:text-gray-300 dark:hover:text-white h-8 w-8 sm:h-9 sm:w-9 p-0 ${isInWishlist(product.id) ? 'text-red-500 dark:text-red-400' : ''
                    }`}
                >
                  <Heart className={`w-4 h-4 sm:w-5 sm:h-5 ${isInWishlist(product.id) ? 'fill-current' : ''}`} />
                </Button>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          className="w-full max-w-7xl mx-auto px-4 sm:px-4 py-3 sm:py-4 lg:py-8 layout-content-container"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-12 max-w-7xl mx-auto items-start w-full">
            {/* Image Gallery - Left Side */}
            <motion.div
              className="lg:order-1 flex-shrink-0 w-full"
              variants={itemVariants}
            >
              <div className="relative w-full">
                {/* Main Image - Optimized for LCP - Render immediately without animation delay */}
                <div
                  className="relative aspect-square bg-background dark:bg-gray-800 rounded-lg sm:rounded-xl lg:rounded-2xl overflow-hidden border-2 border-transparent shadow-elegant dark:shadow-2xl w-full product-detail-image group transform-gpu"
                  style={{
                    width: '100%',
                    willChange: 'transform'
                  }}
                >
                  <Image
                    src={(product.images[currentImageIndex] || '').trim() || '/placeholder.svg'}
                    alt={isRTL ? product.nameAr || product.name : product.name}
                    fill
                    className={`object-contain transition-transform duration-300 group-hover:scale-105 ${product.isOutOfStock ? 'opacity-50' : ''}`}
                    priority={currentImageIndex === 0}
                    fetchPriority={currentImageIndex === 0 ? 'high' : 'auto'}
                    loading={currentImageIndex === 0 ? 'eager' : 'lazy'}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 40vw"
                    quality={currentImageIndex === 0 ? 90 : 75}
                    unoptimized={(product.images[currentImageIndex] || '').trim().startsWith('http')}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.src = '/placeholder.svg'
                    }}
                  />

                  {/* Out of Stock Overlay */}
                  {product.isOutOfStock && (
                    <div className="absolute top-3 inset-x-3 sm:top-4 sm:inset-x-4 z-10 flex justify-center">
                      <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-full">
                        <p className="text-white font-semibold text-sm sm:text-base">نفاذ الكمية</p>
                      </div>
                    </div>
                  )}

                  {/* Zoom Button */}
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute top-2 right-2 sm:top-4 sm:right-4 bg-background/80 dark:bg-gray-800/80 backdrop-blur-sm hover:bg-background/90 dark:hover:bg-gray-800/90 h-8 w-8 sm:h-9 sm:w-9 p-0"
                    onClick={() => setShowImageModal(true)}
                  >
                    <ZoomIn className="w-3 h-3 sm:w-4 sm:h-4" />
                  </Button>

                  {/* Navigation Arrows */}
                  {product.images.length > 1 && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="absolute left-2 sm:left-4 top-1/2 transform -translate-y-1/2 bg-background/80 backdrop-blur-sm hover:bg-background/90 h-8 w-8 sm:h-9 sm:w-9 p-0"
                        onClick={prevImage}
                      >
                        <ChevronLeft className="w-3 h-3 sm:w-4 sm:h-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="absolute right-2 sm:right-4 top-1/2 transform -translate-y-1/2 bg-background/80 backdrop-blur-sm hover:bg-background/90 h-8 w-8 sm:h-9 sm:w-9 p-0"
                        onClick={nextImage}
                      >
                        <ChevronRight className="w-3 h-3 sm:w-4 sm:h-4" />
                      </Button>
                    </>
                  )}
                </div>

                {/* Thumbnails - Show all but limit visible area */}
                {product.images.length > 1 && (
                  <div className="mt-3 sm:mt-4 lg:mt-6">
                    <motion.div
                      className="flex space-x-2 sm:space-x-4 overflow-x-auto pb-2 scrollbar-hide max-h-[80px] sm:max-h-none"
                      variants={itemVariants}
                    >
                      {product.images.map((image, index) => (
                        <motion.button
                          key={index}
                          className={`relative aspect-square w-10 h-10 sm:w-14 sm:h-14 lg:w-20 lg:h-20 rounded-md sm:rounded-lg overflow-hidden border-2 transition-all duration-300 flex-shrink-0 ${index === currentImageIndex
                            ? 'border-primary shadow-elegant scale-105'
                            : 'border-border hover:border-primary/50'
                            }`}
                          onClick={() => setCurrentImageIndex(index)}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          style={{ willChange: 'transform' }}
                        >
                          <Image
                            src={(image || '').trim()}
                            alt={`${isRTL ? product.nameAr || product.name : product.name} - Image ${index + 1}`}
                            fill
                            className="object-contain"
                            loading="lazy"
                            sizes="(max-width: 640px) 40px, (max-width: 1024px) 56px, 80px"
                            unoptimized={typeof image === 'string' && image.trim().startsWith('http')}
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              target.src = '/placeholder.svg'
                            }}
                          />
                        </motion.button>
                      ))}
                    </motion.div>
                    {product.images.length > 5 && isMobile && (
                      <p className="text-xs text-muted-foreground mt-2 text-center">
                        {isRTL ? `عرض ${product.images.length} صورة` : `View ${product.images.length} images`}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </motion.div>

            {/* Product Details - Right Side */}
            <motion.div
              className="lg:order-2 space-y-4 sm:space-y-6 lg:space-y-8 min-w-0"
              variants={itemVariants}
            >
              {/* Product Header */}
              <div className="space-y-3 sm:space-y-4">
                {/* Badges */}
                <motion.div
                  className="flex flex-wrap gap-1.5 sm:gap-2"
                  variants={itemVariants}
                >
                  {product.isOnSale && (
                    <Badge className="bg-gradient-to-r from-red-500 to-pink-500 text-white border-0">
                      <Sparkles className="w-3 h-3 mr-1" />
                      {isRTL ? 'تخفيض' : 'Sale'}
                    </Badge>
                  )}
                  {product.isLaunch && (
                    <Badge className="bg-gradient-to-r from-blue-500 to-purple-500 text-white border-0">
                      <TrendingUp className="w-3 h-3 mr-1" />
                      {isRTL ? 'قريباً' : 'Coming Soon'}
                    </Badge>
                  )}
                  {product.isOutOfStock && (
                    <Badge className="bg-gray-500 text-white border-0">
                      {isRTL ? 'نفاذ الكمية' : 'Out of Stock'}
                    </Badge>
                  )}
                  {product.isLaunch && product.launchAt && (
                    <LaunchCountdownEnhanced
                      launchAt={product.launchAt}
                      onComplete={() => setTimerCompleted(true)}
                      variant="card"
                      className="mt-2"
                    />
                  )}
                  <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                    {isRTL ? 'مجموعة تقليدية' : 'Traditional Collection'}
                  </Badge>
                  {/* LOW STOCK BADGE */}
                  {!product.isOutOfStock && (product.stock <= 5 || (selectedSize && product.sizes?.find(s => s.size === selectedSize)?.stock! <= 5)) && (
                    <Badge className="bg-amber-500 text-white border-0 animate-pulse">
                      <TrendingUp className="w-3 h-3 mr-1" />
                      {isRTL ? 'كمية محدودة جداً' : 'Low Stock'}
                    </Badge>
                  )}
                </motion.div>

                {/* Title */}
                <motion.h1
                  className="text-xl sm:text-2xl lg:text-3xl xl:text-4xl font-bold text-foreground leading-tight"
                  variants={itemVariants}
                >
                  {isRTL ? product.nameAr || product.name : product.name}
                </motion.h1>

              </div>

              {/* Price */}
              <motion.div
                className="space-y-2"
                variants={itemVariants}
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <span className="text-xl sm:text-2xl lg:text-3xl font-bold text-foreground">
                    {product.price.toLocaleString()} DA
                  </span>
                  {product.oldPrice && product.oldPrice > product.price && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <span className="text-base sm:text-lg lg:text-xl text-muted-foreground line-through">
                        {product.oldPrice.toLocaleString()} DA
                      </span>
                      <Badge className="bg-primary/10 text-primary border-primary/20 w-fit text-xs sm:text-sm">
                        {Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100)}% OFF
                      </Badge>
                    </div>
                  )}
                </div>
              </motion.div>

              {/* Color Selection - Only for Victoria Dress */}
              {colorVariants.length > 0 && (
                <motion.div
                  className="space-y-2 sm:space-y-3 lg:space-y-4"
                  variants={itemVariants}
                >
                  <h3 className="text-base sm:text-lg font-semibold text-foreground">
                    {isRTL ? 'اللون' : 'Color'}
                  </h3>
                  <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                    {colorVariants.map((variant) => (
                      <Link
                        key={variant.slug}
                        href={`/loud-styles/products/${variant.slug}?brand=loud-styles`}
                        className={`group relative flex flex-col items-center gap-1.5 transition-all duration-300 ${variant.isCurrent
                          ? 'opacity-100'
                          : 'opacity-60 hover:opacity-100'
                          }`}
                      >
                        <div
                          className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 transition-all duration-300 ${variant.isCurrent
                            ? 'border-primary shadow-lg scale-110'
                            : 'border-border hover:border-primary/50 cursor-pointer'
                            }`}
                          style={{
                            backgroundColor: variant.hexColor || (variant.color === 'black' ? '#000000' : '#722F37')
                          }}
                        >
                          {variant.isCurrent && (
                            <div className="absolute top-0 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center">
                              <Check className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: variant.hexColor === '#FFFFFF' || variant.hexColor === '#FDFBF7' || variant.hexColor === '#F5F5DC' ? '#000000' : '#FFFFFF' }} />
                            </div>
                          )}
                        </div>
                        <span className={`text-xs sm:text-sm font-medium text-center ${variant.isCurrent
                          ? 'text-primary font-semibold'
                          : 'text-foreground'
                          }`}>
                          {isRTL ? variant.name : variant.nameEn}
                        </span>
                      </Link>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Description */}
              <motion.div
                className="space-y-2 sm:space-y-3 lg:space-y-4"
                variants={itemVariants}
              >
                <h3 className="text-base sm:text-lg font-semibold text-foreground">
                  {isRTL ? 'الوصف' : 'Description'}
                </h3>
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                  {isRTL ? product.descriptionAr || product.description : product.description}
                </p>
              </motion.div>

              {/* Size Selection */}
              {displaySizes.length > 0 && (
                <motion.div
                  className="space-y-2 sm:space-y-3 lg:space-y-4"
                  variants={itemVariants}
                >
                  <h3 className="text-base sm:text-lg font-semibold text-foreground">
                    {isRTL ? 'المقاس' : 'Size'}
                  </h3>
                  {!isOrderable && product.isLaunch && product.launchAt && (
                    <div className="mb-2 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                      <p className="text-sm text-orange-800 dark:text-orange-200">
                        {isRTL
                          ? 'يرجى الانتظار حتى انتهاء العد التنازلي لاختيار المقاس'
                          : 'Please wait for the countdown to finish before selecting a size'
                        }
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-1.5 sm:gap-2 lg:gap-3">
                    {displaySizes.map((size) => (
                      <motion.button
                        key={size}
                        disabled={!isOrderable}
                        className={`group relative px-3 py-2 sm:px-4 sm:py-2.5 lg:px-6 lg:py-3 rounded-md sm:rounded-lg border-2 transition-all duration-300 font-medium text-sm sm:text-base ${!isOrderable
                          ? 'opacity-50 cursor-not-allowed border-muted bg-muted/50'
                          : selectedSize === size
                            ? 'border-primary bg-primary text-primary-foreground shadow-elegant'
                            : 'border-border hover:border-primary/50 bg-background hover:bg-muted/50'
                          }`}
                        onClick={() => {
                          if (isOrderable) {
                            setSelectedSize(size)
                          }
                        }}
                        whileHover={isOrderable ? { scale: 1.05 } : {}}
                        whileTap={isOrderable ? { scale: 0.95 } : {}}
                        style={{ willChange: 'transform' }}
                      >
                        {size}
                        {/* Enhanced Hover Tooltip - Only for non-shoe sizes */}
                        {isOrderable && !isShoes && sizeMapping[size as keyof typeof sizeMapping] && (
                          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-3 px-4 py-2 bg-gradient-to-r from-gray-900 to-gray-800 text-white text-sm rounded-lg shadow-2xl border border-gray-700 pointer-events-none whitespace-nowrap z-20 opacity-0 group-hover:opacity-100 transition-all duration-200 ease-out">
                            <div className="flex items-center space-x-2">
                              <span className="font-semibold text-white">{size}</span>
                              <span className="text-gray-300">=</span>
                              <span className="font-mono text-yellow-400">
                                {sizeMapping[size as keyof typeof sizeMapping] || size}
                              </span>
                            </div>
                            {/* Arrow pointing down */}
                            <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800"></div>
                          </div>
                        )}
                      </motion.button>
                    ))}
                    {/* Size Guide Button - styled to match Add to Cart button */}
                    <motion.button
                      className="group relative px-3 py-2 sm:px-4 sm:py-2.5 lg:px-6 lg:py-3 rounded-md sm:rounded-lg border-2 transition-all duration-300 font-medium text-sm sm:text-base bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground shadow-elegant hover:shadow-luxury border-transparent"
                      onClick={() => setShowSizeGuide(!showSizeGuide)}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      style={{ willChange: 'transform' }}
                    >
                      {isRTL ? 'جدول المقاسات' : 'Size Guide'}
                    </motion.button>
                  </div>

                  {/* Size Guide Modal */}
                  <Dialog open={showSizeGuide} onOpenChange={setShowSizeGuide}>
                    <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" dir={isRTL ? 'rtl' : 'ltr'}>
                      <DialogHeader>
                        <DialogTitle className="text-lg sm:text-xl font-bold text-foreground">
                          {isRTL ? 'دليل المقاسات' : 'Size Guide'}
                        </DialogTitle>
                      </DialogHeader>
                      <div className="p-4 sm:p-6">

                        {/* Size Selection Buttons */}
                        <div className="mb-6">
                          <p className="text-sm text-muted-foreground mb-3">
                            {isRTL ? 'المقاس المعروض.' : 'Size displayed.'}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {displaySizes.map((size) => {
                              const isSelected = selectedSize === size || (!selectedSize && size === displaySizes[0])
                              return (
                                <button
                                  key={size}
                                  onClick={() => setSelectedSize(size)}
                                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${isSelected
                                    ? 'bg-black text-white border-2 border-black'
                                    : 'bg-white text-gray-700 border-2 border-gray-300 hover:border-gray-400'
                                    }`}
                                >
                                  {size}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        {/* Dress Figure and Size Chart - Vertical Layout */}
                        <div className="flex flex-col gap-8 items-center">
                          {/* Body Figure with Temu measurements */}
                          <div className="relative flex flex-col items-center justify-center w-full">
                            <div className="relative w-full max-w-[264px] mx-auto flex justify-center">
                              {/* Use Temu body image from public folder - image already has measurement lines */}
                              {/* Image dimensions: 264x561 */}
                              <div className="relative w-full">
                                <img
                                  src="/temu-body-size.png"
                                  alt={isRTL ? 'رسم توضيحي للجسم' : 'Body measurement guide'}
                                  className="w-full h-auto object-contain"
                                />
                                {/* Overlay measurement numbers only - positioned on existing lines */}
                                {/* Coordinates: Bust(85,181), Waist(85,228), Hips(85,288), Height(208,280) */}
                                <svg
                                  viewBox="0 0 264 561"
                                  className="absolute inset-0 w-full h-full pointer-events-none"
                                  xmlns="http://www.w3.org/2000/svg"
                                  preserveAspectRatio="xMidYMid meet"
                                >
                                  {/* Bust Measurement Range - exact coordinates (85, 181) */}
                                  <circle cx="85" cy="181" r="18" fill="#d4af37" opacity="0.95" stroke="white" strokeWidth="2" />
                                  <text x="85" y="185" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                                    {(() => {
                                      const currentSize = selectedSize || displaySizes[0] || (isShoes ? '36' : 'M')
                                      // For shoes, don't show body measurements (not applicable)
                                      if (isShoes) return 'N/A'
                                      const sizeData: Record<string, string> = {
                                        'M': '86-94',
                                        'L': '95-101',
                                        'XL': '101-107',
                                        'XXL': '107-113',
                                        'XXXL': '113-119'
                                      }
                                      return sizeData[currentSize] || '86-94'
                                    })()}
                                  </text>

                                  {/* Waist Measurement Range - exact coordinates (85, 228) */}
                                  <circle cx="85" cy="228" r="18" fill="#d4af37" opacity="0.95" stroke="white" strokeWidth="2" />
                                  <text x="85" y="232" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                                    {(() => {
                                      const currentSize = selectedSize || displaySizes[0] || (isShoes ? '36' : 'M')
                                      // For shoes, don't show body measurements (not applicable)
                                      if (isShoes) return 'N/A'
                                      const sizeData: Record<string, string> = {
                                        'M': '66-74',
                                        'L': '75-81',
                                        'XL': '81-87',
                                        'XXL': '87-93',
                                        'XXXL': '93-99'
                                      }
                                      return sizeData[currentSize] || '66-74'
                                    })()}
                                  </text>

                                  {/* Hips Measurement Range - exact coordinates (85, 288) */}
                                  <circle cx="85" cy="288" r="18" fill="#d4af37" opacity="0.95" stroke="white" strokeWidth="2" />
                                  <text x="85" y="292" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                                    {(() => {
                                      const currentSize = selectedSize || displaySizes[0] || (isShoes ? '36' : 'M')
                                      // For shoes, don't show body measurements (not applicable)
                                      if (isShoes) return 'N/A'
                                      const sizeData: Record<string, string> = {
                                        'M': '91-99',
                                        'L': '100-106',
                                        'XL': '106-112',
                                        'XXL': '112-118',
                                        'XXXL': '118-124'
                                      }
                                      return sizeData[currentSize] || '91-99'
                                    })()}
                                  </text>

                                  {/* Height Measurement Range - exact coordinates (208, 280) */}
                                  <circle cx="208" cy="280" r="17" fill="#d4af37" opacity="0.95" stroke="white" strokeWidth="2" />
                                  <text x="208" y="284" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                                    {(() => {
                                      const currentSize = selectedSize || displaySizes[0] || (isShoes ? '36' : 'M')
                                      // For shoes, don't show body measurements (not applicable)
                                      if (isShoes) return 'N/A'
                                      const sizeData: Record<string, string> = {
                                        'M': '165-175',
                                        'L': '175-180',
                                        'XL': '175-180',
                                        'XXL': '180-185',
                                        'XXXL': '180-185'
                                      }
                                      return sizeData[currentSize] || '165-175'
                                    })()}
                                  </text>
                                </svg>
                              </div>
                            </div>
                          </div>

                          {/* Size Chart Table - Below body image */}
                          <div className="w-full max-w-2xl mx-auto">
                            <div className="rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg overflow-x-auto">
                              <table className="w-full border-collapse">
                                <thead>
                                  <tr className="bg-gray-50 dark:bg-gray-800">
                                    <th className="px-3 py-2 text-right text-xs font-semibold text-foreground">
                                      المقاس
                                    </th>
                                    <th className="px-3 py-2 text-right text-xs font-semibold text-foreground">
                                      الصدر
                                    </th>
                                    <th className="px-3 py-2 text-right text-xs font-semibold text-foreground">
                                      الخصر
                                    </th>
                                    <th className="px-3 py-2 text-right text-xs font-semibold text-foreground">
                                      الورك
                                    </th>
                                    <th className="px-3 py-2 text-right text-xs font-semibold text-foreground">
                                      الطول
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[
                                    { size: 'M', chest: '86-94', waist: '66-74', hips: '91-99', height: '165-175' }, // Combined S/M
                                    { size: 'L', chest: '95-101', waist: '75-81', hips: '100-106', height: '175-180' },
                                    { size: 'XL', chest: '101-107', waist: '81-87', hips: '106-112', height: '175-180' },
                                    { size: 'XXL', chest: '107-113', waist: '87-93', hips: '112-118', height: '180-185' },
                                    { size: 'XXXL', chest: '113-119', waist: '93-99', hips: '118-124', height: '180-185' }
                                  ].filter(item => displaySizes.includes(item.size)).map((item, index) => {
                                    const isSelected = selectedSize === item.size || (!selectedSize && index === 0)
                                    return (
                                      <tr
                                        key={item.size}
                                        className={`transition-colors ${isSelected
                                          ? 'bg-[#d4af37]/20 border-l-4 border-[#d4af37]'
                                          : index % 2 === 0
                                            ? 'bg-white dark:bg-gray-900'
                                            : 'bg-gray-50 dark:bg-gray-800'
                                          }`}
                                      >
                                        <td className={`px-3 py-2 text-right text-xs font-medium ${isSelected ? 'text-[#d4af37] font-bold' : 'text-foreground'
                                          }`}>
                                          {item.size}
                                        </td>
                                        <td className={`px-3 py-2 text-right text-xs ${isSelected ? 'text-[#d4af37] font-semibold' : 'text-muted-foreground'
                                          }`}>
                                          {item.chest}
                                        </td>
                                        <td className={`px-3 py-2 text-right text-xs ${isSelected ? 'text-[#d4af37] font-semibold' : 'text-muted-foreground'
                                          }`}>
                                          {item.waist}
                                        </td>
                                        <td className={`px-3 py-2 text-right text-xs ${isSelected ? 'text-[#d4af37] font-semibold' : 'text-muted-foreground'
                                          }`}>
                                          {item.hips}
                                        </td>
                                        <td className={`px-3 py-2 text-right text-xs ${isSelected ? 'text-[#d4af37] font-semibold' : 'text-muted-foreground'
                                          }`}>
                                          {item.height}
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>

                        {/* Disclaimer */}
                        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                          <p className="text-xs text-muted-foreground text-center" dir="rtl">
                            البيانات مقاسة يدوياً وقد يكون هناك اختلافات طفيفة.
                          </p>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </motion.div>
              )}

              {/* Quantity */}
              <motion.div
                className="space-y-2 sm:space-y-3 lg:space-y-4"
                variants={itemVariants}
              >
                <h3 className="text-base sm:text-lg font-semibold text-foreground">
                  {isRTL ? 'الكمية' : 'Quantity'}
                </h3>
                <div className="flex items-center space-x-3 sm:space-x-4">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="h-9 w-9 sm:h-10 sm:w-10"
                    disabled={!isOrderable}
                  >
                    <Minus className="w-3 h-3 sm:w-4 sm:h-4" />
                  </Button>
                  <span className="text-base sm:text-lg font-medium min-w-[2.5rem] sm:min-w-[3rem] text-center">
                    {quantity}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setQuantity(quantity + 1)}
                    className="h-9 w-9 sm:h-10 sm:w-10"
                    disabled={!isOrderable}
                  >
                    <Plus className="w-3 h-3 sm:w-4 sm:h-4" />
                  </Button>
                </div>
              </motion.div>

              {/* Action Buttons */}
              <motion.div
                className="space-y-3 sm:space-y-4"
                variants={itemVariants}
              >
                {!isOrderable && product.isLaunch && product.launchAt && (
                  <div className="mb-2 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                    <p className="text-sm text-orange-800 dark:text-orange-200">
                      {isRTL
                        ? 'يرجى الانتظار حتى انتهاء العد التنازلي لإضافة المنتج للسلة أو الشراء'
                        : 'Please wait for the countdown to finish before adding to cart or purchasing'
                      }
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 lg:gap-4">
                  <Button
                    size="lg"
                    className="h-11 sm:h-12 lg:h-14 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground font-semibold shadow-elegant hover:shadow-luxury transition-all duration-300 text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleAddToCart}
                    disabled={!isOrderable || (!isAccessoires && product.sizes && product.sizes.length > 0 && !selectedSize)}
                  >
                    <ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                    <span>{isRTL ? 'أضف للسلة' : 'Add to Cart'}</span>
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-11 sm:h-12 lg:h-14 border-2 border-foreground text-foreground hover:bg-foreground hover:text-background font-semibold shadow-elegant transition-all duration-300 text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!isOrderable || (!isAccessoires && product.sizes && product.sizes.length > 0 && !selectedSize)}
                    onClick={() => {
                      if (!isOrderable) {
                        toast.error(isRTL ? 'يرجى الانتظار حتى انتهاء العد التنازلي' : 'Please wait for the countdown to finish')
                        return
                      }

                      // Only require size if product has sizes and is not accessoires
                      if (!isAccessoires && product.sizes && product.sizes.length > 0 && !selectedSize) {
                        toast.error(isRTL ? 'يرجى اختيار المقاس' : 'Please select a size')
                        return
                      }

                      // Add to cart first
                      const selectedSizeObj = getSelectedSizeObject(selectedSize);
                      addItem({
                        id: product.id,
                        name: isRTL ? product.nameAr || product.name : product.name,
                        price: product.price,
                        image: product.images[0],
                        size: isAccessoires ? undefined : (selectedSize || undefined),
                        sizeId: isAccessoires ? undefined : selectedSizeObj?.id
                      })

                      // Redirect to checkout
                      router.push('/checkout')
                    }}
                  >
                    <span>{isRTL ? 'اشتري الآن' : 'Buy Now'}</span>
                  </Button>
                </div>
              </motion.div>

              {/* Service Highlights */}
              <motion.div
                className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 lg:gap-4 pt-3 sm:pt-4 lg:pt-6 border-t border-border dark:border-gray-700"
                variants={itemVariants}
              >
                <div className="text-center space-y-2 p-4 rounded-lg bg-background/50 dark:bg-gray-800/50">
                  <div className="flex items-center justify-center">
                    <Image
                      src="/logos/yalidine.png"
                      alt="Yalidine"
                      width={60}
                      height={60}
                      className="object-contain h-15 w-15"
                    />
                  </div>
                  <p className="text-xs font-medium text-foreground dark:text-gray-200">
                    {isRTL ? 'شحن مع ياليدين' : 'Shipping with Yalidine'}
                  </p>
                </div>
                <div className="text-center space-y-2 p-4 rounded-lg bg-background/50 dark:bg-gray-800/50">
                  <Shield className="h-6 w-6 text-primary mx-auto" />
                  <p className="text-xs font-medium text-foreground dark:text-gray-200">
                    {isRTL ? 'أصالة' : 'Authenticity'}
                  </p>
                </div>
                <div className="text-center space-y-2 p-4 rounded-lg bg-background/50 dark:bg-gray-800/50">
                  <MessageCircle className="h-6 w-6 text-primary mx-auto" />
                  <p className="text-xs font-medium text-foreground dark:text-gray-200">
                    {isRTL ? 'خدمة عملاء احترافية' : 'Professional Customer Service'}
                  </p>
                </div>
              </motion.div>
            </motion.div>
          </div>

          {/* Additional Information Below - Fixed grid to prevent CLS */}
          <motion.div
            className="max-w-7xl mx-auto mt-6 sm:mt-8 lg:mt-16 layout-content-container"
            variants={itemVariants}
          >
            <div
              className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 lg:gap-8"
            >
              {/* Craftsmanship Card */}
              <Card
                className="bg-background/50 dark:bg-gray-800/50 backdrop-blur-sm border-border dark:border-gray-700 shadow-elegant dark:shadow-2xl"
                style={{ minHeight: '200px' }}
              >
                <CardContent className="p-4 sm:p-5 lg:p-6">
                  <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-3 sm:mb-4" style={{ minHeight: '1.5em' }}>
                    {isRTL ? 'الصناعة الرفيعة' : 'Craftsmanship'}
                  </h3>
                  <p className="text-sm sm:text-base text-muted-foreground leading-relaxed" style={{ minHeight: '3em' }}>
                    {isRTL
                      ? 'نؤمن أن الفخامة تبدأ من المادة. لهذا نعتمد أقمشة مستوردة، ونطوّر تصاميمنا في دبي، مع عناية دقيقة بكل مرحلة من مراحل التنفيذ'
                      : 'Each piece is meticulously handcrafted by skilled artisans using traditional techniques passed down through generations.'
                    }
                  </p>
                </CardContent>
              </Card>

              {/* Care Instructions Card */}
              <Card
                className="bg-background/50 dark:bg-gray-800/50 backdrop-blur-sm border-border dark:border-gray-700 shadow-elegant dark:shadow-2xl"
                style={{ minHeight: '200px' }}
              >
                <CardContent className="p-4 sm:p-5 lg:p-6">
                  <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-3 sm:mb-4" style={{ minHeight: '1.5em' }}>
                    {isRTL ? 'تعليمات العناية' : 'Care Instructions'}
                  </h3>
                  <ul className="space-y-1.5 sm:space-y-2 text-sm sm:text-base text-muted-foreground" style={{ minHeight: '6em' }}>
                    <li className="flex items-center space-x-2">
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                      <span>{isRTL ? 'يفضل الغسل اليدوي بالماء البارد.' : 'Dry clean only'}</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                      <span>{isRTL ? 'استخدم منظف لطيف، وابتعد عن الشمس المباشرة أثناء التجفيف.' : 'Store flat'}</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                      <span>{isRTL ? 'اكوي بدرجة حرارة منخفضة عند الحاجة.' : 'Avoid direct sunlight'}</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                      <span>{isRTL ? 'خزّن في مكان جاف لتحافظ على فخامتها وجمالها.' : 'Handle with clean, dry hands'}</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </motion.div>
        </motion.div>

        {/* Image Modal */}
        <AnimatePresence>
          {showImageModal && (
            <motion.div
              className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowImageModal(false)}
            >
              <motion.div
                className="relative max-w-4xl max-h-[90vh] w-full h-full"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ duration: 0.3 }}
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  className="absolute top-4 right-4 z-10 bg-background/80 backdrop-blur-sm hover:bg-background/90"
                  onClick={() => setShowImageModal(false)}
                >
                  <X className="w-4 h-4" />
                </Button>

                <div className="relative w-full h-full">
                  <Image
                    src={product.images[currentImageIndex] || '/placeholder.svg'}
                    alt={isRTL ? product.nameAr || product.name : product.name}
                    fill
                    className="object-contain"
                    sizes="100vw"
                    unoptimized={(product.images[currentImageIndex] || '').startsWith('http')}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.src = '/placeholder.svg'
                    }}
                  />
                </div>

                {product.images.length > 1 && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-background/80 dark:bg-gray-800/80 backdrop-blur-sm hover:bg-background/90 dark:hover:bg-gray-800/90"
                      onClick={prevImage}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-background/80 dark:bg-gray-800/80 backdrop-blur-sm hover:bg-background/90 dark:hover:bg-gray-800/90"
                      onClick={nextImage}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Accessories Bottom Alert Panel - Horizontal, Centered */}
        <AnimatePresence>
          {showAccessoryPopup && relatedAccessories.length > 0 && (
            <motion.div
              className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none p-2 sm:p-4"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{
                type: 'spring',
                damping: 25,
                stiffness: 200
              }}
            >
              <motion.div
                className="bg-white border-2 border-[#d4af37] shadow-2xl rounded-2xl p-3 sm:p-4 md:p-6 pointer-events-auto mx-auto"
                style={{
                  width: '100%',
                  maxWidth: isMobile ? '100%' : '600px',
                  minWidth: isMobile ? 'auto' : '500px'
                }}
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                transition={{ delay: 0.1 }}
              >
                {/* Header with close button */}
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <div className="flex-1">
                    <motion.h2
                      className="text-sm sm:text-base md:text-lg font-bold text-gray-900 mb-1"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.2 }}
                    >
                      {isRTL ? '✨ أكمل إطلالتك ✨' : '✨ Complete Your Look ✨'}
                    </motion.h2>
                    <motion.p
                      className="text-gray-600 text-xs sm:text-sm"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 }}
                    >
                      {isRTL
                        ? 'إكسسوارات مطابقة'
                        : 'Matching accessories'
                      }
                    </motion.p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 sm:h-9 sm:w-9 text-gray-700 hover:bg-gray-100 rounded-full flex-shrink-0 ml-2 sm:ml-4"
                    onClick={() => {
                      setShowAccessoryPopup(false)
                      setAccessoryPopupDismissed(true)
                    }}
                  >
                    <X className="w-4 h-4 sm:w-5 sm:h-5" />
                  </Button>
                </div>

                {/* Accessories Layout - Responsive: Horizontal scroll on mobile, grid on desktop */}
                <div className={`${isMobile ? 'flex gap-4 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory' : 'grid grid-cols-3 gap-4'} justify-center items-start`}>
                  {relatedAccessories.slice(0, 3).map((accessory, index) => {
                    // Get image URL - handle different possible formats
                    let imageUrl = '/placeholder.svg'

                    // The API returns images as an array of strings
                    if (accessory.images && Array.isArray(accessory.images) && accessory.images.length > 0) {
                      // Get first image (should be a string URL)
                      const firstImage = accessory.images[0]
                      if (typeof firstImage === 'string' && firstImage.trim() !== '') {
                        imageUrl = firstImage.trim()
                        // Ensure absolute URL if it's a relative path
                        if (imageUrl.startsWith('/') && !imageUrl.startsWith('//')) {
                          // Keep relative paths as is (Next.js will handle them)
                          imageUrl = imageUrl
                        }
                      } else if (typeof firstImage === 'object' && firstImage !== null && 'url' in firstImage) {
                        // Handle case where it's an object with url property
                        imageUrl = (firstImage as any).url || '/placeholder.svg'
                      }
                    }
                    // Fallback: check for image property (single image)
                    else if ((accessory as any).image && typeof (accessory as any).image === 'string') {
                      imageUrl = (accessory as any).image.trim()
                    }

                    // Final validation - ensure we have a valid URL
                    if (!imageUrl || imageUrl.trim() === '' || imageUrl === '/placeholder.svg') {
                      imageUrl = '/placeholder.svg'
                    }

                    // Debug logging (remove in production if needed)
                    if (process.env.NODE_ENV === 'development') {
                      console.log('Accessory image debug:', {
                        accessoryName: accessory.name,
                        images: accessory.images,
                        imageUrl,
                        hasImages: Array.isArray(accessory.images) && accessory.images.length > 0
                      })
                    }

                    return (
                      <motion.div
                        key={accessory.id}
                        className={`group relative ${isMobile ? 'flex-shrink-0 snap-center' : ''}`}
                        style={{ minWidth: isMobile ? '120px' : 'auto', maxWidth: isMobile ? '140px' : 'auto' }}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.4 + index * 0.1 }}
                        whileHover={{ scale: 1.05 }}
                      >
                        {/* Circular Card */}
                        <div className={`bg-gray-50 rounded-full overflow-hidden border-2 border-[#d4af37] hover:border-[#d4af37]/80 transition-all duration-300 p-2 flex flex-col items-center justify-center mx-auto ${isMobile ? 'w-24 h-24' : 'w-28 h-28 sm:w-32 sm:h-32'
                          }`}>
                          {/* Circular Product Image */}
                          <div className={`relative rounded-full overflow-hidden bg-white ${isMobile ? 'w-16 h-16' : 'w-20 h-20 sm:w-24 sm:h-24'
                            }`}>
                            <img
                              src={imageUrl}
                              alt={isRTL ? accessory.nameAr || accessory.name : accessory.name}
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement
                                console.error('Image failed to load:', imageUrl, 'for accessory:', accessory.name)
                                if (target.src !== '/placeholder.svg') {
                                  target.src = '/placeholder.svg'
                                }
                              }}
                              onLoad={() => {
                                if (process.env.NODE_ENV === 'development') {
                                  console.log('Image loaded successfully:', imageUrl, 'for accessory:', accessory.name)
                                }
                              }}
                              loading="lazy"
                            />
                          </div>
                        </div>

                        {/* Product Info Below Circle */}
                        <div className={`mt-2 text-center ${isMobile ? 'w-full' : 'w-full'}`}>
                          <h3 className={`font-semibold text-gray-900 line-clamp-2 mb-1 ${isMobile ? 'text-[10px]' : 'text-xs sm:text-sm'
                            }`}>
                            {isRTL ? accessory.nameAr || accessory.name : accessory.name}
                          </h3>
                          <span className={`font-bold text-[#d4af37] block mb-1.5 ${isMobile ? 'text-[10px]' : 'text-xs sm:text-sm'
                            }`}>
                            {accessory.price.toLocaleString()} DA
                          </span>
                          <Button
                            size="sm"
                            className={`w-full bg-[#d4af37] text-white hover:bg-[#d4af37]/90 font-semibold ${isMobile
                              ? 'text-[10px] h-6 px-2'
                              : 'text-xs h-7 sm:h-8 px-3'
                              }`}
                            onClick={() => {
                              handleAddAccessoryToCart(accessory)
                            }}
                          >
                            <ShoppingCart className={`${isMobile ? 'w-3 h-3' : 'w-3.5 h-3.5 sm:w-4 sm:h-4'} mr-1`} />
                            {isRTL ? 'أضف' : 'Add'}
                          </Button>
                        </div>
                      </motion.div>
                    )
                  })}
                </div>

                {/* Footer */}
                <div className="mt-3 sm:mt-4 pt-3 border-t border-gray-200 text-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white border-[#d4af37] text-[#d4af37] hover:bg-[#d4af37]/10 hover:text-[#d4af37] text-xs h-8 sm:h-9 px-4 sm:px-6"
                    onClick={() => {
                      setShowAccessoryPopup(false)
                      setAccessoryPopupDismissed(true)
                    }}
                  >
                    {isRTL ? 'لاحقاً' : 'Later'}
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </React.Fragment>
  )
}
