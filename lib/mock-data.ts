export type Product = { id: string; category: string; name: string; price: number; image: string; colors: string[]; audience: 'Men' | 'Women' };
export type Order = { id: string; name: string; image: string; status: 'Delivered' | 'In transit'; date: string; total: number; items: string[] };
export type CartLine = { product: Product; quantity: number; selectedVariant?: string };
export type ProductRequest = { id: string; name: string; category: string; notes: string; createdAt: string; status: 'Submitted' | 'Under review' | 'Fulfilled' };
export type MemberInvite = { name: string; email: string; createdAt: string; status: 'Pending' | 'Accepted' | 'Expired' };

export const products: Product[] = [
  { id: 'sandal', category: 'Our Picks', name: 'WMX Rubber Zebra Sandal', price: 36, image: 'https://images.unsplash.com/photo-1562273138-f46be4ebdf33?auto=format&fit=crop&w=900&q=85', colors: ['#f287b7', '#ffe17c'], audience: 'Women' },
  { id: 'jogger', category: 'Your Choice', name: 'Supper Skinny jogger in brown', price: 89, image: 'https://images.unsplash.com/photo-1552346154-21d32810aba3?auto=format&fit=crop&w=900&q=85', colors: ['#e8dc31', '#272727'], audience: 'Men' },
];

export const recentOrders: Order[] = [
  { id: 'DXC-1048', name: 'DXC Nike Air', image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=120&q=80', status: 'Delivered', date: '18 Nov 2026', total: 89, items: ['DXC Nike Air'] },
  { id: 'OUT-1036', name: 'Outerwear edit', image: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=120&q=80', status: 'In transit', date: '16 Nov 2026', total: 124, items: ['Weekend trench', 'Soft knit scarf'] },
];
