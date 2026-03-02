// Ensure API_BASE_URL doesn't have double /api
// App name: loudbrands-backend-eu → URL: loudbrands-backend-eu-abfa65dd1df6.herokuapp.com
const getApiBaseUrl = () => {
  const url = process.env.NEXT_PUBLIC_API_URL || 'https://loudbrands-backend-eu-abfa65dd1df6.herokuapp.com/api';
  // Remove trailing /api if present to avoid double /api/api
  return url.replace(/\/api\/?$/, '') + '/api';
};

const API_BASE_URL = getApiBaseUrl();

// Helper function to get auth token
const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null;

  try {
    const authData = localStorage.getItem('auth-storage');
    if (authData) {
      const parsedData = JSON.parse(authData);
      return parsedData?.state?.token || parsedData?.token || null;
    }
  } catch (error) {
    console.warn('Failed to parse auth token:', error);
  }
  return null;
};

class ApiClient {
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;

    // Only log in development
    if (process.env.NODE_ENV === 'development') {
      console.log('API Request:', {
        method: options.method || 'GET',
        url,
        endpoint,
        baseURL: this.baseURL
      });
    }

    const config: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    // Add auth token if available
    if (typeof window !== 'undefined') {
      const token = getAuthToken();
      if (process.env.NODE_ENV === 'development') {
        console.log('Auth token available:', !!token);
      }
      if (token) {
        config.headers = {
          ...config.headers,
          Authorization: `Bearer ${token}`,
        };
      }
    }

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.message || `HTTP error! status: ${response.status}`;
        const validationError = new Error(errorMessage);
        (validationError as any).response = { data: errorData, status: response.status };

        // Log detailed error information
        console.error('❌ API Error:', {
          url,
          status: response.status,
          statusText: response.statusText,
          error: errorData,
          endpoint
        });

        throw validationError;
      }

      if (response.status === 204) return undefined as T;
      const data = await response.json();

      // Log successful responses in development
      if (process.env.NODE_ENV === 'development') {
        console.log('✅ API Response:', {
          url,
          status: response.status,
          dataKeys: Object.keys(data)
        });
      }

      return data;
    } catch (error) {
      // Enhanced error logging
      if (error instanceof TypeError && error.message.includes('fetch')) {
        console.error('❌ Network Error:', {
          url,
          endpoint,
          message: 'Network request failed. Check internet connection or API server status.'
        });
      }
      throw error;
    }
  }

  // Products
  async getProducts(
    params?: {
      page?: number;
      limit?: number;
      search?: string;
      category?: string;
      brand?: string;
      minPrice?: number;
      maxPrice?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      inStock?: boolean;
      onSale?: boolean;
    },
    options?: RequestInit
  ) {
    const searchParams = new URLSearchParams();

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });
    }

    const query = searchParams.toString();
    return this.request(`/products${query ? `?${query}` : ''}`, options);
  }

  async getProduct(id: string) {
    return this.request(`/products/${id}`);
  }

  async getFeaturedProducts() {
    return this.request('/products/featured/list');
  }

  // Categories
  async getCategories(params?: { brand?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.brand) {
      searchParams.append('brand', params.brand);
    }
    const query = searchParams.toString();
    return this.request(`/categories${query ? `?${query}` : ''}`);
  }

  async getCategory(slug: string, params?: { brand?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.brand) {
      searchParams.append('brand', params.brand);
    }
    const query = searchParams.toString();
    return this.request(`/categories/${slug}${query ? `?${query}` : ''}`);
  }

  // Orders
  async createOrder(orderData: {
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    deliveryType: 'HOME_DELIVERY' | 'PICKUP';
    deliveryAddress?: string;
    wilayaId: number;
    deliveryDeskId?: string;
    notes?: string;
    items: Array<{
      productId: string;
      quantity: number;
      sizeId?: string;
    }>;
  }) {
    return this.request('/orders', {
      method: 'POST',
      body: JSON.stringify(orderData),
    });
  }

  async getOrder(id: string) {
    return this.request(`/orders/${id}`);
  }

  // Auth
  async login(email: string, password: string) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async register(userData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async getCurrentUser() {
    return this.request('/auth/me');
  }

  // Admin endpoints
  async getDashboardStats() {
    return this.request('/admin/dashboard/stats');
  }

  async getRecentOrders() {
    return this.request('/admin/dashboard/recent-orders');
  }

  async getLowStockProducts() {
    return this.request('/admin/dashboard/low-stock');
  }

  async getAdminOrders(params?: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
    confirmedOnly?: string;
  }) {
    const searchParams = new URLSearchParams();

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });
    }

    const query = searchParams.toString();
    return this.request(`/admin/orders${query ? `?${query}` : ''}`);
  }

  async updateOrderStatus(
    orderId: string,
    status: {
      callCenterStatus?: string;
      deliveryStatus?: string;
      notes?: string;
      deliveryType?: string;
      deliveryAddress?: string;
      deliveryDeskId?: string;
      deliveryFee?: number;
      total?: number;
      trackingNumber?: string;
      yalidineShipmentId?: string;
      appendNote?: string;
    }
  ) {
    return this.request(`/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify(status),
    });
  }

  async updateOrderItems(
    orderId: string,
    data: {
      items: Array<{
        id: string;
        name: string;
        nameAr?: string;
        quantity: number;
        price: number;
        size?: string;
        product: {
          id: string;
          name: string;
          nameAr?: string;
          image?: string;
        };
      }>;
      subtotal: number;
      total: number;
    }
  ) {
    return this.request(`/admin/orders/${orderId}/items`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteOrder(id: string) {
    return this.request(`/admin/orders/${id}`, {
      method: 'DELETE',
    });
  }

  async getUsers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
  }) {
    const searchParams = new URLSearchParams();

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });
    }

    const query = searchParams.toString();
    return this.request(`/admin/users${query ? `?${query}` : ''}`);
  }

  // Ateliers
  async getAteliers() {
    return this.request<{ ateliers: { id: string; name: string; createdAt: string }[] }>('/ateliers');
  }

  async createAtelier(data: { name: string }) {
    return this.request<{ id: string; name: string; createdAt: string }>('/ateliers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteAtelier(id: string) {
    return this.request(`/ateliers/${id}`, { method: 'DELETE' });
  }

  // Inventory Reception (atelierId required; backend computes totalCost)
  async createReception(data: {
    atelierId: string;
    date?: string;
    notes?: string;
    items: Array<{
      productName: string;
      reference?: string;
      size: string | null;
      quantity: number;
      barcode?: string;
    }>;
  }) {
    return this.request('/inventory/receptions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateReception(id: string, data: {
    paymentStatus?: string;
    totalCost?: number;
    amountPaid?: number;
    notes?: string;
  }) {
    return this.request(`/inventory/receptions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async getReceptions() {
    return this.request('/inventory/receptions');
  }

  async deleteReception(id: string) {
    return this.request(`/inventory/receptions/${id}`, { method: 'DELETE' });
  }
}

export const apiClient = new ApiClient(API_BASE_URL);

// Utility functions for common API calls
export const api = {
  // Products
  products: {
    getAll: (params?: Parameters<typeof apiClient.getProducts>[0], options?: RequestInit) =>
      apiClient.getProducts(params, options),
    getById: (id: string) => apiClient.getProduct(id),
    getFeatured: () => apiClient.getFeaturedProducts(),
    scanProduct: (barcode: string, action: 'add' | 'remove') =>
      apiClient.request<{ success: boolean; product: any; message: string }>(`/products/scan`, {
        method: 'POST',
        body: JSON.stringify({ barcode, action })
      }),
  },

  // Categories
  categories: {
    getAll: (params?: { brand?: string }) => apiClient.getCategories(params),
    getBySlug: (slug: string, params?: { brand?: string }) => apiClient.getCategory(slug, params),
  },

  // Orders
  orders: {
    create: (data: Parameters<typeof apiClient.createOrder>[0]) =>
      apiClient.createOrder(data),
    getById: (id: string) => apiClient.getOrder(id),
  },

  // Auth
  auth: {
    login: (email: string, password: string) => apiClient.login(email, password),
    register: (data: Parameters<typeof apiClient.register>[0]) =>
      apiClient.register(data),
    getCurrentUser: () => apiClient.getCurrentUser(),
  },

  // Admin
  admin: {
    getDashboardStats: () => apiClient.getDashboardStats(),
    getRecentOrders: () => apiClient.getRecentOrders(),
    getLowStockProducts: () => apiClient.getLowStockProducts(),
    getProducts: (params?: {
      page?: number;
      limit?: number;
      search?: string;
      category?: string;
      status?: string;
    }) => apiClient.request(`/admin/products${params ? `?${new URLSearchParams({ ...params, limit: params.limit?.toString() || '1000' } as any).toString()}` : '?limit=1000'}`, { cache: 'no-store' }),
    getOrders: (params?: Parameters<typeof apiClient.getAdminOrders>[0]) =>
      apiClient.getAdminOrders(params),
    createOrder: (data: any) => apiClient.request('/admin/orders', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    updateOrderStatus: (
      orderId: string,
      status: Parameters<typeof apiClient.updateOrderStatus>[1]
    ) => apiClient.updateOrderStatus(orderId, status),
    updateOrderItems: (
      orderId: string,
      data: Parameters<typeof apiClient.updateOrderItems>[1]
    ) => apiClient.updateOrderItems(orderId, data),
    deleteOrder: (id: string) => apiClient.deleteOrder(id),

    getUsers: (params?: Parameters<typeof apiClient.getUsers>[0]) =>
      apiClient.getUsers(params),
    createUser: (data: {
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      password: string;
      role?: string;
    }) => apiClient.request('/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    updateUser: (id: string, data: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      role?: string;
      password?: string;
    }) => apiClient.request(`/admin/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    deleteUser: (id: string) => apiClient.request(`/admin/users/${id}`, {
      method: 'DELETE',
    }),
    // Products management (use admin endpoint so fetch is by id, not public slug)
    getProduct: (id: string) => apiClient.request(`/admin/products/${id}`),
    createProduct: (data: any) => apiClient.request('/admin/products', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    updateProduct: (id: string, data: any) => apiClient.request(`/admin/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    deleteProduct: (id: string) => apiClient.request(`/admin/products/${id}`, {
      method: 'DELETE',
    }),
    updateWholesalePrices: async (updates: { id: string, wholesalePrice: number | null }[]) => {
      return apiClient.request('/admin/products/wholesale-prices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates })
      })
    },
    // Inventory management
    getInventory: (params?: {
      page?: number;
      limit?: number;
      search?: string;
      category?: string;
      stockFilter?: string;
      status?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            searchParams.append(key, value.toString());
          }
        });
      }
      const query = searchParams.toString();
      return apiClient.request(`/admin/inventory${query ? `?${query}` : ''}`);
    },
    exportInventory: async () => {
      const response = await fetch(`${API_BASE_URL}/admin/inventory/export`, {
        headers: {
          'Content-Type': 'text/csv',
          ...(typeof window !== 'undefined' ? {
            Authorization: `Bearer ${getAuthToken()}`
          } : {})
        }
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
      }

      return await response.text();
    },
    importInventory: (data: any) => apiClient.request('/admin/inventory/import', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    // Ateliers
    getAteliers: () => apiClient.getAteliers(),
    createAtelier: (data: { name: string }) => apiClient.createAtelier(data),
    deleteAtelier: (id: string) => apiClient.deleteAtelier(id),
    // Stock Receptions (Arrivals) – atelierId required; backend computes totalCost
    createReception: (data: Parameters<typeof apiClient.createReception>[0]) =>
      apiClient.createReception(data),
    getReceptions: () => apiClient.getReceptions(),
    deleteReception: (id: string) => apiClient.deleteReception(id),
    // Stock Movements
    createStockMovement: (data: {
      type: 'in' | 'out';
      barcode?: string | null;
      productName: string;
      productReference?: string | null;
      size?: string | null;
      quantity: number;
      oldStock?: number | null;
      newStock?: number | null;
      orderNumber?: string | null;
      trackingNumber?: string | null;
      notes?: string | null;
      operationType?: 'entree' | 'sortie' | 'echange' | 'retour' | null;
    }) => apiClient.request('/inventory/movements', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    getStockMovements: (params?: {
      type?: 'in' | 'out';
      operationType?: 'entree' | 'sortie' | 'echange' | 'retour';
      limit?: number;
    }) => {
      const searchParams = new URLSearchParams();
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            searchParams.append(key, value.toString());
          }
        });
      }
      const query = searchParams.toString();
      return apiClient.request(`/inventory/movements${query ? `?${query}` : ''}`);
    },
    // Brand-specific inventory management
    getInventoryByBrand: (brandSlug: string, params?: {
      page?: number;
      limit?: number;
      search?: string;
      category?: string;
      stockFilter?: string;
      status?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            searchParams.append(key, value.toString());
          }
        });
      }
      const query = searchParams.toString();
      return apiClient.request(`/admin/inventory/brand/${brandSlug}${query ? `?${query}` : ''}`);
    },
    exportInventoryByBrand: async (brandSlug: string) => {
      const response = await fetch(`${API_BASE_URL}/admin/inventory/brand/${brandSlug}/export`, {
        headers: {
          'Content-Type': 'text/csv',
          ...(typeof window !== 'undefined' ? {
            Authorization: `Bearer ${getAuthToken()}`
          } : {})
        }
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
      }

      return await response.text();
    },
    // Orders export (returns JSON for Excel conversion)
    exportOrders: async () => {
      const response = await fetch(`${API_BASE_URL}/admin/orders/export`, {
        headers: {
          'Content-Type': 'application/json',
          ...(typeof window !== 'undefined' ? {
            Authorization: `Bearer ${getAuthToken()}`
          } : {})
        }
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
      }

      return await response.json();
    },
    // Categories management
    getCategories: () => apiClient.request('/admin/categories'),
    getCategoriesByBrand: (brandSlug: string) => apiClient.request(`/admin/categories/brand/${brandSlug}`),
    createCategory: (data: any) => apiClient.request('/admin/categories', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    updateCategory: (id: string, data: any) => apiClient.request(`/admin/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    deleteCategory: (id: string) => apiClient.request(`/admin/categories/${id}`, {
      method: 'DELETE',
    }),
    // Brands management
    getBrands: () => apiClient.request('/admin/brands'),
    getBrand: (id: string) => apiClient.request(`/admin/brands/${id}`),
    createBrand: (data: any) => apiClient.request('/admin/brands', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    updateBrand: (id: string, data: any) => apiClient.request(`/admin/brands/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    deleteBrand: (id: string) => apiClient.request(`/admin/brands/${id}`, {
      method: 'DELETE',
    }),
    // Profit Analytics
    getProfitAnalytics: (brandSlug?: string) => {
      const params = brandSlug ? `?brandSlug=${brandSlug}` : '';
      return apiClient.request(`/admin/analytics/profit-by-category${params}`);
    },
    // Analytics
    getTopProducts: (limit?: number) => {
      const params = limit ? `?limit=${limit}` : '';
      return apiClient.request(`/admin/analytics/top-products${params}`);
    },
    getSalesByCategory: () => apiClient.request('/admin/analytics/sales-by-category'),
    getOrdersByCity: () => apiClient.request('/admin/analytics/orders-by-city'),
    getComprehensiveAnalytics: () => apiClient.request('/admin/analytics/comprehensive'),
    getTimeSeriesAnalytics: () => apiClient.request('/admin/analytics/time-series'),
    getInventoryIntelligence: () => apiClient.request('/admin/analytics/inventory-intelligence'),
    getOrdersTimeline: (period?: string) => {
      const params = period ? `?period=${period}` : '';
      return apiClient.request(`/admin/analytics/orders-timeline${params}`);
    },
  },

  // Shipping (Yalidine)
  shipping: {
    getStatus: () => apiClient.request('/shipping/status'),
    shipOrder: (orderId: string) =>
      apiClient.request<{ success: boolean; tracking: string; import_id: string; error?: string; message?: string }>(`/shipping/ship-order/${orderId}`, { method: 'POST' }),
    getParcel: (tracking: string) => apiClient.request<any>(`/shipping/shipment/${encodeURIComponent(tracking)}`),

    getWilayas: () => apiClient.request('/shipping/wilayas'),
    getCommunes: (wilayaId?: number) => {
      const params = wilayaId ? `?wilayaId=${wilayaId}` : '';
      return apiClient.request(`/shipping/communes${params}`);
    },
    getCenters: (wilayaId?: number) => {
      const params = wilayaId ? `?wilayaId=${wilayaId}` : '';
      return apiClient.request(`/shipping/centers${params}`);
    },
    calculateFees: (data: any) => apiClient.request('/shipping/calculate-fees', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    createShipment: (data: any) => apiClient.request('/shipping/create-shipment', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    getShipment: (tracking: string) => apiClient.request(`/shipping/shipment/${encodeURIComponent(tracking)}`),
    getTracking: (tracking: string) => apiClient.request(`/shipping/tracking/${encodeURIComponent(tracking)}`),
    updateShipment: (tracking: string, data: any) => apiClient.request(`/shipping/shipment/${encodeURIComponent(tracking)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    deleteShipment: (tracking: string) => apiClient.request(`/shipping/shipment/${encodeURIComponent(tracking)}`, {
      method: 'DELETE',
    }),
    getAllShipments: (filters?: {
      status?: string;
      tracking?: string;
      order_id?: string;
      to_wilaya_id?: number;
      to_commune_name?: string;
      is_stopdesk?: boolean;
      freeshipping?: boolean;
      date_creation?: string;
      date_last_status?: string;
      payment_status?: string;
      month?: string;
      page?: number;
    }) => {
      const searchParams = new URLSearchParams();
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            searchParams.append(key, value.toString());
          }
        });
      }
      const query = searchParams.toString();
      return apiClient.request(`/shipping/shipments${query ? `?${query}` : ''}`);
    },
    getShipmentStats: () => apiClient.request('/shipping/shipments/stats'),
  },

  // Ateliers (top-level for admin ateliers & inventory/smart)
  getAteliers: () => apiClient.getAteliers(),
  createAtelier: (data: { name: string }) => apiClient.createAtelier(data),
  deleteAtelier: (id: string) => apiClient.deleteAtelier(id),

  // Inventory
  createReception: (data: Parameters<typeof apiClient.createReception>[0]) =>
    apiClient.createReception(data),
  updateReception: (id: string, data: Parameters<typeof apiClient.updateReception>[1]) =>
    apiClient.updateReception(id, data),
  getReceptions: () => apiClient.getReceptions(),
  deleteReception: (id: string) => apiClient.deleteReception(id),
  // Tracking validation (scoped per operationType: sortie, echange, retour)
  validateTracking: (trackingNumber: string, operationType: string) =>
    apiClient.request<{ valid: boolean; message?: string }>(
      `/inventory/validate-tracking?${new URLSearchParams({ trackingNumber, operationType }).toString()}`
    ),
  lookupSortieByTracking: (trackingNumber: string) =>
    apiClient.request<{ items: Array<{ productName: string; productReference?: string; size: string; quantity: number; barcode?: string }>; count: number }>(
      `/inventory/lookup-sortie-by-tracking?${new URLSearchParams({ trackingNumber }).toString()}`
    ),
};

export default apiClient;