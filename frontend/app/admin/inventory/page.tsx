'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Package,
  Search,
  Filter,
  Download,
  Upload,
  Plus,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  FileSpreadsheet,
  Eye,
  Edit,
  Trash2
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { AdminLayout } from '@/components/admin/admin-layout'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { useAuthStore } from '@/lib/store'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface Product {
  id: string
  name: string
  nameAr: string
  price: number
  costPrice?: number
  oldPrice?: number
  stock: number
  category: {
    id: string
    name: string
    slug: string
  }
  reference: string
  isOnSale: boolean
  isActive: boolean
  image: string
  createdAt: string
  sizes?: Array<{
    id: string
    size: string
    stock: number
  }>
  totalStock?: number
  description?: string
  descriptionAr?: string
}

interface InventoryStats {
  totalProducts: number
  lowStockProducts: number
  outOfStockProducts: number
  totalValueRetail: number
  totalValueCost: number
  totalStock: number
}

export default function AdminInventoryPage() {
  const { user } = useAuthStore()
  const [mounted, setMounted] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [totalPages, setTotalPages] = useState(1)
  const [totalProducts, setTotalProducts] = useState(0)
  const [stats, setStats] = useState<InventoryStats>({
    totalProducts: 0,
    lowStockProducts: 0,
    outOfStockProducts: 0,
    totalValueRetail: 0,
    totalValueCost: 0,
    totalStock: 0
  })

  // Check if user is stock manager or confirmatrice (hide purchase price and total value)
  const shouldHidePriceInfo = user?.role === 'STOCK_MANAGER' || user?.role === 'CONFIRMATRICE'
  // Check if user is confirmatrice or stock manager (hide action buttons)
  const shouldHideActions = user?.role === 'CONFIRMATRICE' || user?.role === 'STOCK_MANAGER'

  useEffect(() => {
    setMounted(true)
    fetchProducts()
  }, [])

  // Fetch products when page changes, but only if not handled by handleSearch/filter change
  useEffect(() => {
    if (mounted) {
      fetchProducts(page, searchQuery)
    }
  }, [page])

  const fetchProducts = async (pageNum: number = page, search: string = searchQuery) => {
    try {
      setLoading(true)

      // Build query parameters
      const params: any = {
        page: pageNum,
        limit,
      }

      if (search) params.search = search
      if (categoryFilter !== 'all') params.category = categoryFilter
      if (stockFilter !== 'all') params.stockFilter = stockFilter
      if (statusFilter !== 'all') params.status = statusFilter

      const response = await api.products.getAll(params) as any
      const productsList = response.products || []
      setProducts(productsList)
      setTotalPages(response.pagination?.pages || 1)
      setTotalProducts(response.pagination?.total || productsList.length)

      // Fetch stats separately (all products for accurate stats)
      const statsResponse = await api.admin.getInventory({ limit: 10000 }) as { products: Product[] }
      const allProducts = statsResponse.products || []

      // Calculate stats using totalStock from backend (already calculated correctly)
      let totalStock = 0
      let totalValueRetail = 0
      let totalValueCost = 0
      let lowStockProducts = 0
      let outOfStockProducts = 0

      allProducts.forEach(product => {
        // Use totalStock from backend (already includes main stock + sizes)
        const productTotalStock = product.totalStock || 0

        totalStock += productTotalStock
        const price = product.price || 0
        const cost = product.costPrice || 0

        totalValueRetail += price * productTotalStock
        totalValueCost += cost * productTotalStock

        if (productTotalStock === 0) {
          outOfStockProducts += 1
        } else if (productTotalStock <= 5) {
          lowStockProducts += 1
        }
      })

      setStats({
        totalProducts: allProducts.length,
        lowStockProducts,
        outOfStockProducts,
        totalValueRetail,
        totalValueCost,
        totalStock
      })
    } catch (error) {
      console.error('Failed to fetch products:', error)
      toast.error('Failed to load inventory data')
    } finally {
      setLoading(false)
    }
  }

  // Reset page when filters change
  useEffect(() => {
    if (mounted && (categoryFilter !== 'all' || stockFilter !== 'all' || statusFilter !== 'all')) {
      setPage(1)
      fetchProducts(1, searchQuery)
    }
  }, [categoryFilter, stockFilter, statusFilter])

  const handleSearch = () => {
    setSearchQuery(inputValue)
    setPage(1)
    fetchProducts(1, inputValue)
  }

  const exportToExcel = async () => {
    try {
      toast.loading('Preparing export...');

      const response = await api.admin.exportInventory() as string;

      if (!response) {
        throw new Error('No data received from server');
      }

      // Create and download file
      const blob = new Blob([response], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `inventory-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.dismiss();
      toast.success('Inventory exported successfully');
    } catch (error) {
      console.error('Export failed:', error);
      toast.dismiss();
      toast.error(`Failed to export inventory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  const importFromExcel = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string
        const lines = text.split('\n')
        const headers = lines[0].split(',').map(h => h.trim())

        // Parse CSV and create products
        const productsToImport = lines.slice(1).filter(line => line.trim()).map(line => {
          const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
          return {
            reference: values[0],
            name: values[1],
            nameAr: values[2],
            category: values[3],
            price: parseFloat(values[4]) || 0,
            oldPrice: parseFloat(values[5]) || undefined,
            mainStock: parseInt(values[6]) || 0,
            sizes: values[7],
            totalStock: parseInt(values[8]) || 0,
            status: values[9],
            isOnSale: values[10] === 'Yes',
            description: values[12],
            descriptionAr: values[13]
          }
        })

        // Send to API
        const result = await api.admin.importInventory({ products: productsToImport }) as {
          message: string;
          results: {
            created: number;
            updated: number;
            errors: any[];
          };
        }

        toast.success(`Import completed: ${result.results.created} created, ${result.results.updated} updated`)

        // Refresh the inventory
        fetchProducts()

      } catch (error) {
        console.error('Import failed:', error)
        toast.error('Failed to import products')
      }
    }
    reader.readAsText(file)
  }

  const getStockStatus = (stock: number) => {
    if (stock === 0) return { label: 'Out of Stock', color: 'bg-red-100 text-red-800' }
    if (stock <= 5) return { label: 'Low Stock', color: 'bg-yellow-100 text-yellow-800' }
    return { label: 'In Stock', color: 'bg-green-100 text-green-800' }
  }

  const formatSizes = (sizes: Product['sizes']) => {
    if (!sizes || sizes.length === 0) return 'No sizes'
    // Sort sizes: M, L, XL, XXL, XXXL first, then others
    const sizeOrder: Record<string, number> = {
      'M': 1,
      'L': 2,
      'XL': 3,
      'XXL': 4,
      'XXXL': 5
    }
    const sortedSizes = [...sizes].sort((a, b) => {
      const orderA = sizeOrder[a.size] ?? 999
      const orderB = sizeOrder[b.size] ?? 999
      return orderA - orderB
    })
    return sortedSizes.map(size => `${size.size}: ${size.stock}`).join(', ')
  }

  if (!mounted) return null

  const categories = Array.from(new Set(products.map(product => product.category?.name).filter(Boolean)))

  if (loading) {
    return (
      <AdminLayout>
        <div className="space-y-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold">Gestion d'Inventaire</h1>
              <p className="text-muted-foreground">
                Gérez votre inventaire de produits, suivez les niveaux de stock et importez/exportez des données
              </p>
            </div>
          </div>
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-2 text-muted-foreground">Chargement de l'inventaire...</p>
          </div>
        </div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Gestion d'Inventaire</h1>
            <p className="text-muted-foreground">
              Gérez votre inventaire de produits, suivez les niveaux de stock et importez/exportez des données
            </p>
          </div>

          {/* Brand-specific Inventory Links */}
          <div className="flex items-center space-x-3">
            <Link href="/admin/inventory/loudim">
              <Button variant="outline" className="flex items-center space-x-2">
                <Package className="w-4 h-4" />
                <span>Inventaire LOUDIM</span>
              </Button>
            </Link>
            <Link href="/admin/inventory/loud-styles">
              <Button variant="outline" className="flex items-center space-x-2">
                <Package className="w-4 h-4" />
                <span>Inventaire LOUD STYLES</span>
              </Button>
            </Link>
          </div>
          <div className="flex items-center space-x-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Upload className="w-4 h-4 mr-2" />
                  Importer Excel
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Importer des Produits depuis Excel</DialogTitle>
                  <DialogDescription>
                    Upload a CSV file with product data. Make sure the file has the correct format.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <Input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={importFromExcel}
                    placeholder="Choose file..."
                  />
                  <p className="text-sm text-muted-foreground">
                    Download the template file to see the required format.
                  </p>
                </div>
              </DialogContent>
            </Dialog>
            <Button onClick={exportToExcel}>
              <Download className="w-4 h-4 mr-2" />
              Exporter Excel
            </Button>
            <Button asChild>
              <Link href="/admin/products/new">
                <Plus className="w-4 h-4 mr-2" />
                Ajouter Produit
              </Link>
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className={`grid grid-cols-1 gap-6 ${shouldHidePriceInfo ? 'md:grid-cols-4' : 'md:grid-cols-5'}`}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Total Produits</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalProducts}</div>
                <p className="text-xs text-muted-foreground">
                  All products in inventory
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Stock Total</CardTitle>
                <Package className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">{stats.totalStock}</div>
                <p className="text-xs text-muted-foreground">
                  Total units available
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Stock Faible</CardTitle>
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">{stats.lowStockProducts}</div>
                <p className="text-xs text-muted-foreground">
                  Produits avec ≤5 unités
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Rupture de Stock</CardTitle>
                <TrendingDown className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{stats.outOfStockProducts}</div>
                <p className="text-xs text-muted-foreground">
                  Produits avec 0 unités
                </p>
              </CardContent>
            </Card>
          </motion.div>

          {!shouldHidePriceInfo && (
            <>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium">Valeur Stock (Prix d'Achat)</CardTitle>
                    <TrendingDown className="h-4 w-4 text-red-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-600">
                      {stats.totalValueCost.toLocaleString()} DA
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Valeur totale du stock au prix d&apos;achat
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium">Valeur Stock (Prix de Vente)</CardTitle>
                    <TrendingUp className="h-4 w-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      {stats.totalValueRetail.toLocaleString()} DA
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Valeur totale du stock au prix de vente
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            </>
          )}
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Filtres</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Recherche</label>
                <Input
                  placeholder="Rechercher des produits... (Appuyez sur Entrée)"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSearch()
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Catégorie</label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Statut du Stock</label>
                <Select value={stockFilter} onValueChange={setStockFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All stock levels" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les niveaux de stock</SelectItem>
                    <SelectItem value="in">En stock (&gt;5)</SelectItem>
                    <SelectItem value="low">Stock faible (≤5)</SelectItem>
                    <SelectItem value="out">Rupture de stock</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Statut</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tous les statuts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les statuts</SelectItem>
                    <SelectItem value="active">Actif</SelectItem>
                    <SelectItem value="inactive">Inactif</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Inventory Table */}
        <Card>
          <CardHeader>
            <CardTitle>Inventaire des Produits</CardTitle>
            <p className="text-sm text-muted-foreground">
              Affichage de {products.length} produits (Page {page} sur {totalPages}) - Total: {totalProducts} produits
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto w-full">
              <Table className="w-full min-w-[1400px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">Image</TableHead>
                    <TableHead className="w-[120px]">Référence</TableHead>
                    <TableHead className="w-[200px]">Nom</TableHead>
                    <TableHead className="w-[150px]">Catégorie</TableHead>
                    {!shouldHidePriceInfo && (
                      <TableHead className="w-[120px]">Prix d'Achat (DA)</TableHead>
                    )}
                    <TableHead className="w-[120px]">Prix de Vente (DA)</TableHead>
                    <TableHead className="w-[100px]">Stock Principal</TableHead>
                    <TableHead className="w-[200px]">Tailles & Quantités</TableHead>
                    <TableHead className="w-[100px]">Stock Total</TableHead>
                    <TableHead className="w-[100px]">Statut</TableHead>
                    {!shouldHideActions && (
                      <TableHead className="w-[100px]">Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product) => {
                    const stockStatus = getStockStatus(product.stock)
                    return (
                      <TableRow key={product.id}>
                        <TableCell className="w-[80px]">
                          <div className="relative w-12 h-12 rounded-lg overflow-hidden">
                            <Image
                              src={product.image || '/placeholder.svg'}
                              alt={product.name}
                              fill
                              className="object-cover"
                            />
                          </div>
                        </TableCell>
                        <TableCell className="w-[120px] font-mono text-sm">
                          <div className="truncate">{product.reference}</div>
                        </TableCell>
                        <TableCell className="w-[200px]">
                          <div>
                            <div className="font-medium truncate">{product.name}</div>
                            {product.nameAr && (
                              <div className="text-sm text-muted-foreground truncate">{product.nameAr}</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="w-[150px]">
                          <Badge variant="outline" className="truncate">{product.category?.name}</Badge>
                        </TableCell>
                        {!shouldHidePriceInfo && (
                          <TableCell className="w-[120px]">
                            <div className="font-medium text-blue-600">
                              {product.costPrice ? product.costPrice.toLocaleString() : '0'} DA
                            </div>
                          </TableCell>
                        )}
                        <TableCell className="w-[120px]">
                          <div>
                            <div className="font-medium">{product.price.toLocaleString()} DA</div>
                            {product.oldPrice && (
                              <div className="text-sm text-muted-foreground line-through">
                                {product.oldPrice.toLocaleString()} DA
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="w-[100px]">
                          <div className="text-center">
                            <span className="font-medium">{product.stock}</span>
                          </div>
                        </TableCell>
                        <TableCell className="w-[200px]">
                          <div className="max-w-xs">
                            <div className="text-sm text-muted-foreground truncate">
                              {formatSizes(product.sizes)}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="w-[100px]">
                          <div className="flex items-center space-x-2">
                            <span className="font-medium">{product.stock}</span>
                            <Badge className={stockStatus.color}>
                              {stockStatus.label}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="w-[100px]">
                          <Badge variant={product.isActive ? "default" : "secondary"}>
                            {product.isActive ? 'Actif' : 'Inactif'}
                          </Badge>
                        </TableCell>
                        {!shouldHideActions && (
                          <TableCell className="w-[100px]">
                            <div className="flex items-center space-x-2">
                              <Button variant="ghost" size="sm" asChild>
                                <Link href={`/admin/products/${product.id}`}>
                                  <Eye className="w-4 h-4" />
                                </Link>
                              </Button>
                              <Button variant="ghost" size="sm" asChild>
                                <Link href={`/admin/products/${product.id}/edit`}>
                                  <Edit className="w-4 h-4" />
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <div className="text-sm text-muted-foreground">
                  Page {page} sur {totalPages} - Total: {totalProducts} produits
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1 || loading}
                  >
                    Précédent
                  </Button>

                  {/* Page numbers */}
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum: number
                      if (totalPages <= 5) {
                        pageNum = i + 1
                      } else if (page <= 3) {
                        pageNum = i + 1
                      } else if (page >= totalPages - 2) {
                        pageNum = totalPages - 4 + i
                      } else {
                        pageNum = page - 2 + i
                      }

                      return (
                        <Button
                          key={pageNum}
                          variant={page === pageNum ? "default" : "outline"}
                          size="sm"
                          onClick={() => setPage(pageNum)}
                          disabled={loading}
                          className="w-9"
                        >
                          {pageNum}
                        </Button>
                      )
                    })}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages || loading}
                  >
                    Suivant
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  )
}