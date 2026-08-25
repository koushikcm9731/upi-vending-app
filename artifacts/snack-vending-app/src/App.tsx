import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import {
  ArrowRight,
  BarChart3,
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  ExternalLink,
  Gauge,
  Layers3,
  Minus,
  PackageCheck,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShoppingBag,
  Sparkles,
  Store,
  Tag,
  TriangleAlert,
  WalletCards,
  X,
} from 'lucide-react';
import {
  getGetAdminSummaryQueryKey,
  getGetOrderStatusQueryKey,
  getListProductsQueryKey,
  useCreateOrder,
  useGetAdminSummary,
  useGetOrderStatus,
  useListProducts,
} from '@workspace/api-client-react';
import type { Product, StatusResponse } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

type Cart = Record<string, number>;
type RazorpayOrder = { orderId: string; razorpayOrderId: string; razorpayKeyId: string; amount: number };

const loadRazorpayCheckout = () => new Promise<void>((resolve, reject) => {
  if ((window as any).Razorpay) { resolve(); return; }
  const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
  if (existing) {
    existing.addEventListener('load', () => resolve(), { once: true });
    existing.addEventListener('error', () => reject(new Error('Razorpay checkout could not load')), { once: true });
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://checkout.razorpay.com/v1/checkout.js';
  script.async = true;
  script.onload = () => resolve();
  script.onerror = () => reject(new Error('Razorpay checkout could not load'));
  document.body.appendChild(script);
});

const money = (value: number) => `₹${value.toFixed(2)}`;
const statusLabel = (status?: string) => {
  const value = (status || 'pending').toLowerCase();
  if (value.includes('dispens')) return 'Dispensed';
  if (value.includes('paid') || value.includes('confirm')) return 'Payment confirmed';
  if (value.includes('fail') || value.includes('cancel')) return 'Payment issue';
  return 'Awaiting payment';
};

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-3" data-testid="link-brand-home">
      <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[4px_4px_0_hsl(var(--foreground))]">
        <span className="absolute inset-2 rounded-md border-2 border-current opacity-80" />
        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" />
      </span>
      {!compact && (
        <span className="leading-none">
          <span className="block text-[15px] font-extrabold tracking-[-.04em]">PICK//DROP</span>
          <span className="font-mono-ui mt-1 block text-[9px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">
            autonomous snacks
          </span>
        </span>
      )}
    </Link>
  );
}

function PageHeader({ cartCount, onCart }: { cartCount?: number; onCart?: () => void }) {
  const [location] = useLocation();
  return (
    <header className="sticky top-0 z-10 border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/.9)] px-4 py-4 backdrop-blur-xl md:px-8">
      <div className="mx-auto flex max-w-[1380px] items-center justify-between gap-4">
        <BrandMark compact />
        <nav className="hidden items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.7)] p-1 md:flex">
          <Link href="/" data-testid="link-menu" className={`rounded-full px-4 py-2 text-xs font-bold transition ${location === '/' ? 'bg-[hsl(var(--foreground))] text-[hsl(var(--background))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`}>
            MENU
          </Link>
          <Link href="/status" data-testid="link-status" className={`rounded-full px-4 py-2 text-xs font-bold transition ${location === '/status' ? 'bg-[hsl(var(--foreground))] text-[hsl(var(--background))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`}>
            TRACK ORDER
          </Link>
          <Link href="/admin" data-testid="link-admin" className={`rounded-full px-4 py-2 text-xs font-bold transition ${location === '/admin' ? 'bg-[hsl(var(--foreground))] text-[hsl(var(--background))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`}>
            OPERATIONS
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-2 rounded-full bg-[hsl(var(--secondary)/.1)] px-3 py-2 text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--secondary))] sm:flex">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[hsl(var(--secondary))]" /> Machine online
          </span>
          {onCart && (
            <button onClick={onCart} data-testid="button-open-cart" className="pressable relative grid h-10 w-10 place-items-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]">
              <ShoppingBag size={17} />
              {!!cartCount && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[hsl(var(--primary))] px-1 font-mono-ui text-[10px] text-[hsl(var(--primary-foreground))]">{cartCount}</span>}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function MobileNav() {
  const [location] = useLocation();
  return (
    <nav className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--foreground))] p-1.5 shadow-xl md:hidden">
      {[['/', 'Menu', Store], ['/status', 'Status', PackageCheck], ['/admin', 'Ops', BarChart3]].map(([href, label, Icon]) => (
        <Link key={href as string} href={href as string} data-testid={`link-mobile-${label as string}`} className={`flex min-w-[74px] flex-col items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-bold ${location === href ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-[hsl(var(--background)/.65)]'}`}>
          <Icon size={15} />
          {label as string}
        </Link>
      ))}
    </nav>
  );
}

function Shell({ children, cartCount, onCart }: { children: React.ReactNode; cartCount?: number; onCart?: () => void }) {
  return (
    <div className="app-shell noise min-h-[100dvh]">
      <PageHeader cartCount={cartCount} onCart={onCart} />
      {children}
      <MobileNav />
    </div>
  );
}

function ProductArt({ index, compact = false }: { index: number; compact?: boolean }) {
  const styles = [
    'bg-[hsl(211_100%_50%)] text-white',
    'bg-[hsl(222_47%_13%)] text-[hsl(195_100%_87%)]',
    'bg-[hsl(190_91%_38%)] text-white',
    'bg-[hsl(195_100%_87%)] text-[hsl(222_47%_13%)]',
  ];
  return (
    <div className={`machine-grid relative flex items-center justify-center overflow-hidden rounded-2xl ${compact ? 'h-16 w-16 shrink-0 rounded-xl' : 'h-44'} ${styles[index % styles.length]}`}>
      <div className={`absolute rounded-full border-current opacity-25 ${compact ? '-right-3 -top-4 h-12 w-12 border-[7px]' : '-right-8 -top-10 h-32 w-32 border-[18px]'}`} />
      <div className={`absolute rounded-full border-current opacity-15 ${compact ? '-bottom-5 -left-2 h-14 w-14 border-[9px]' : '-bottom-14 -left-6 h-36 w-36 border-[24px]'}`} />
      <div className="relative rotate-[-7deg] text-center">
        <span className={`block font-black tracking-[-.12em] ${compact ? 'text-xl' : 'text-6xl'}`}>SNK</span>
        {!compact && <span className="font-mono-ui block text-[9px] font-bold tracking-[.3em]">SELECT / EAT</span>}
      </div>
      {!compact && <span className="absolute bottom-3 left-3 rounded bg-[hsl(var(--foreground)/.14)] px-2 py-1 font-mono-ui text-[9px] uppercase">slot {String.fromCharCode(65 + index)}{index + 1}</span>}
    </div>
  );
}

function LoadingProducts() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map((item) => <div key={item} className="animate-pulse rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3"><div className="h-44 rounded-xl bg-[hsl(var(--muted))]" /><div className="mt-4 h-5 w-2/3 rounded bg-[hsl(var(--muted))]" /><div className="mt-3 h-4 w-1/3 rounded bg-[hsl(var(--muted))]" /></div>)}
    </div>
  );
}

function CartDrawer({ cart, products, onClose, onChange, onCheckout, isPending, error }: { cart: Cart; products: Product[]; onClose: () => void; onChange: (id: string, delta: number) => void; onCheckout: () => void; isPending: boolean; error?: string }) {
  const lines = products.filter((product) => cart[product.id]);
  const total = lines.reduce((sum, product) => sum + product.price * (cart[product.id] || 0), 0);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[hsl(var(--foreground)/.32)] backdrop-blur-sm" role="dialog" aria-modal="true">
      <button aria-label="Close cart" data-testid="button-close-cart-overlay" onClick={onClose} className="absolute inset-0 cursor-default" />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--background))] p-5 shadow-2xl rise-in">
        <div className="flex items-start justify-between border-b border-[hsl(var(--border))] pb-5">
          <div><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[hsl(var(--primary))]">Your tray</p><h2 className="mt-1 text-2xl font-extrabold tracking-[-.05em]">Ready to dispense.</h2></div>
          <button onClick={onClose} data-testid="button-close-cart" className="pressable rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><X size={18} /></button>
        </div>
        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center"><div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-dashed border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"><ShoppingBag size={24} /></div><h3 className="font-bold">Tray is empty</h3><p className="mt-1 max-w-[220px] text-sm text-[hsl(var(--muted-foreground))]">Pick a snack and we’ll have it ready in under a minute.</p></div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto py-5">
              {lines.map((product) => <div key={product.id} className="flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3" data-testid={`cart-line-${product.id}`}><ProductArt index={products.indexOf(product)} compact /><div className="min-w-0 flex-1"><h3 className="truncate font-bold">{product.name}</h3><p className="font-mono-ui mt-1 text-xs text-[hsl(var(--muted-foreground))]">{money(product.price)} each</p><div className="mt-2 flex w-fit items-center gap-3 rounded-lg bg-[hsl(var(--muted))] p-1"><button onClick={() => onChange(product.id, -1)} data-testid={`button-decrease-${product.id}`} className="grid h-6 w-6 place-items-center rounded-md hover:bg-[hsl(var(--card))]"><Minus size={13} /></button><span className="font-mono-ui text-xs">{cart[product.id]}</span><button onClick={() => onChange(product.id, 1)} data-testid={`button-increase-${product.id}`} className="grid h-6 w-6 place-items-center rounded-md hover:bg-[hsl(var(--card))]"><Plus size={13} /></button></div></div><span className="self-start font-mono-ui text-sm font-bold">{money(product.price * (cart[product.id] || 0))}</span></div>)}
            </div>
            <div className="border-t border-[hsl(var(--border))] pt-5">
              {error && <p className="mb-3 flex items-center gap-2 rounded-lg bg-[hsl(var(--destructive)/.1)] p-3 text-xs text-[hsl(var(--destructive))]" data-testid="error-create-order"><CircleAlert size={15} /> {error}</p>}
              <div className="mb-4 flex items-end justify-between"><span className="text-sm text-[hsl(var(--muted-foreground))]">Total</span><span className="font-mono-ui text-2xl font-bold">{money(total)}</span></div>
              <button onClick={onCheckout} disabled={isPending} data-testid="button-checkout" className="pressable flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3.5 font-bold text-[hsl(var(--primary-foreground))] shadow-[4px_4px_0_hsl(var(--foreground))] disabled:cursor-wait disabled:opacity-60">{isPending ? <><RefreshCw size={16} className="animate-spin" /> Creating order</> : <>Continue to UPI <ArrowRight size={16} /></>}</button>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[10px] text-[hsl(var(--muted-foreground))]"><ShieldCheck size={13} /> Secure payment handoff. No card details stored.</p>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function Home() {
  const [cart, setCart] = useState<Cart>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [orderError, setOrderError] = useState('');
  const [, setLocation] = useLocation();
  const productsQuery = useListProducts({ query: { queryKey: getListProductsQueryKey() } });
  const createOrder = useCreateOrder();
  const products = productsQuery.data || [];
  const filteredProducts = useMemo(() => products.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())), [products, search]);
  const cartCount = Object.values(cart).reduce((sum, count) => sum + count, 0);

  const changeCart = (id: string, delta: number) => {
    const product = products.find((item) => item.id === id);
    setCart((current) => {
      const next = Math.max(0, Math.min(product?.stock || 0, (current[id] || 0) + delta));
      if (!next) { const { [id]: _, ...rest } = current; return rest; }
      return { ...current, [id]: next };
    });
  };
  const checkout = () => {
    const items = Object.entries(cart).filter(([, qty]) => qty > 0).map(([productId, qty]) => ({ productId, qty }));
    if (!items.length) return;
    setOrderError('');
    createOrder.mutate({ data: { items } }, {
      onSuccess: (order) => {
        sessionStorage.setItem('pickdrop-order', JSON.stringify(order));
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        setLocation('/status');
      },
      onError: () => setOrderError('We couldn’t create that order. Check your connection and try again.'),
    });
  };

  return (
    <Shell cartCount={cartCount} onCart={() => setCartOpen(true)}>
      <main className="mx-auto max-w-[1380px] px-4 pb-28 pt-8 md:px-8 md:pb-12 md:pt-14">
        <section className="grid gap-8 lg:grid-cols-[1.05fr_.95fr] lg:items-end">
          <div className="rise-in">
            <div className="mb-6 flex items-center gap-2 text-[hsl(var(--primary))]"><span className="h-px w-8 bg-current" /><span className="font-mono-ui text-[10px] font-bold uppercase tracking-[.24em]">station 07 / sector food</span></div>
            <h1 className="max-w-3xl text-balance text-[clamp(3.4rem,8vw,7.8rem)] font-extrabold leading-[.84] tracking-[-.085em]">Good snacks.<br /><span className="text-[hsl(var(--primary))]">Zero small talk.</span></h1>
            <p className="mt-7 max-w-lg text-base leading-relaxed text-[hsl(var(--muted-foreground))] md:text-lg">Choose your fix, pay with UPI, and watch the machine do its one job exceptionally well.</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 font-mono-ui text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[hsl(var(--secondary))]" /> Live stock</span><span className="flex items-center gap-2"><Clock3 size={13} /> ~45 sec pickup</span><span className="flex items-center gap-2"><WalletCards size={13} /> UPI ready</span></div>
          </div>
          <div className="machine-grid rise-in rise-in-delay-1 relative overflow-hidden rounded-3xl border border-[hsl(var(--foreground))] bg-[hsl(var(--foreground))] p-6 text-[hsl(var(--background))] shadow-[8px_8px_0_hsl(var(--primary))] md:p-8">
            <div className="scan-bar absolute inset-x-0 top-0 h-full opacity-25" />
            <div className="relative flex items-start justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-[hsl(var(--accent))]">PICK//DROP terminal</p><p className="mt-3 max-w-xs text-2xl font-bold leading-tight tracking-[-.04em]">A tiny shop that never asks how your day is going.</p></div><Gauge className="text-[hsl(var(--accent))]" size={24} /></div>
            <div className="relative mt-10 grid grid-cols-3 gap-2 border-t border-[hsl(var(--background)/.2)] pt-4 font-mono-ui text-[9px] uppercase text-[hsl(var(--background)/.6)]"><span>01 / choose</span><span>02 / pay</span><span className="text-right">03 / collect</span></div>
          </div>
        </section>

        <section className="mt-20" id="snacks">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div><p className="font-mono-ui text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">01 / the line-up</p><h2 className="mt-2 text-3xl font-extrabold tracking-[-.06em] md:text-4xl">Make a quick call.</h2></div>
            <label className="flex w-full items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 md:w-64"><Search size={16} className="text-[hsl(var(--muted-foreground))]" /><input value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-search-products" placeholder="Search the machine" className="w-full bg-transparent text-sm outline-none placeholder:text-[hsl(var(--muted-foreground))]" /></label>
          </div>
          {productsQuery.isLoading ? <LoadingProducts /> : productsQuery.isError ? <StateCard icon={<TriangleAlert size={22} />} title="Machine feed is offline" body="The menu couldn’t load. Give it another scan." action={<button onClick={() => productsQuery.refetch()} data-testid="button-retry-products" className="pressable rounded-lg bg-[hsl(var(--foreground))] px-4 py-2 text-sm font-bold text-[hsl(var(--background))]">Retry feed</button>} /> : filteredProducts.length === 0 ? <StateCard icon={<Search size={22} />} title="No match in this machine" body="Try a different search term or clear the filter." action={<button onClick={() => setSearch('')} data-testid="button-clear-search" className="pressable rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-bold">Clear search</button>} /> : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredProducts.map((product, index) => {
                const quantity = cart[product.id] || 0;
                return <article key={product.id} data-testid={`card-product-${product.id}`} className="group rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.76)] p-3 shadow-[var(--shadow-card)] transition hover:-translate-y-1 hover:border-[hsl(var(--foreground)/.35)]">
                  <ProductArt index={index} />
                  <div className="flex items-start justify-between gap-3 px-1 pb-1 pt-4"><div className="min-w-0"><div className="mb-2 flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${product.stock > 0 ? 'bg-[hsl(var(--secondary))]' : 'bg-[hsl(var(--destructive))]'}`} /><span className="font-mono-ui text-[9px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">{product.stock > 0 ? `${product.stock} in stock` : 'sold out'}</span></div><h3 className="truncate text-lg font-bold tracking-[-.03em]" data-testid={`text-product-name-${product.id}`}>{product.name}</h3></div><span className="font-mono-ui text-sm font-bold" data-testid={`text-product-price-${product.id}`}>{money(product.price)}</span></div>
                  <div className="mt-4 flex items-center gap-2">{quantity > 0 && <div className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.65)] p-1"><button onClick={() => changeCart(product.id, -1)} data-testid={`button-card-decrease-${product.id}`} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[hsl(var(--card))]"><Minus size={14} /></button><span className="w-4 text-center font-mono-ui text-xs">{quantity}</span></div>}<button onClick={() => changeCart(product.id, 1)} disabled={product.stock === 0 || quantity >= product.stock} data-testid={`button-add-product-${product.id}`} className="pressable flex flex-1 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-3 py-2.5 text-xs font-bold text-[hsl(var(--background))] disabled:cursor-not-allowed disabled:opacity-35">{quantity ? 'Add one more' : 'Add to tray'} <Plus size={14} /></button></div>
                </article>;
              })}
            </div>
          )}
        </section>

        <section className="mt-20 grid gap-4 border-t border-[hsl(var(--border))] pt-7 md:grid-cols-3">
          {[['01', 'Choose in seconds', 'A focused menu. No accounts, no distractions.'], ['02', 'Pay your way', 'UPI opens in the app you already trust.'], ['03', 'See the handoff', 'Live status until the snack lands in the bay.']].map(([number, title, copy]) => <div key={number} className="flex gap-4"><span className="font-mono-ui text-xs text-[hsl(var(--primary))]">{number}</span><div><h3 className="font-bold">{title}</h3><p className="mt-1 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{copy}</p></div></div>)}
        </section>
      </main>
      {cartOpen && <CartDrawer cart={cart} products={products} onClose={() => setCartOpen(false)} onChange={changeCart} onCheckout={checkout} isPending={createOrder.isPending} error={orderError} />}
    </Shell>
  );
}

function StateCard({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)] p-8 text-center"><div className="mb-3 text-[hsl(var(--primary))]">{icon}</div><h3 className="font-bold">{title}</h3><p className="mt-1 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">{body}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

function StatusPage() {
  const [location, setLocation] = useLocation();
  const savedOrder = useMemo(() => {
    try {
      const queryOrderId = new URLSearchParams(window.location.search).get('orderId') || new URLSearchParams(window.location.search).get('txn');
      const stored = JSON.parse(sessionStorage.getItem('pickdrop-order') || 'null') as RazorpayOrder | null;
      return queryOrderId && stored?.orderId !== queryOrderId ? { orderId: queryOrderId, upiLink: '', amount: 0 } : stored;
    } catch { return null; }
  }, [location]);
  const [manualId, setManualId] = useState(savedOrder?.orderId || '');
  const [orderId, setOrderId] = useState(savedOrder?.orderId || '');
  const [paymentError, setPaymentError] = useState('');
  const [paymentHandoff, setPaymentHandoff] = useState(false);
  const queryClient = useQueryClient();
  const statusQuery = useGetOrderStatus(orderId || '', { query: { enabled: !!orderId, queryKey: getGetOrderStatusQueryKey(orderId || ''), refetchInterval: orderId ? 2500 : false } });
  const status = statusQuery.data as StatusResponse | undefined;
  const normalized = (status?.status || '').toLowerCase();
  const paid = normalized.includes('paid') || normalized.includes('confirm') || normalized.includes('dispens');
  const dispensed = normalized.includes('dispens');

  const openRazorpayPayment = async () => {
    if (!savedOrder?.razorpayOrderId || !savedOrder.razorpayKeyId) {
      setPaymentError('The Razorpay order is unavailable. Please return to the menu and try again.');
      return;
    }
    setPaymentHandoff(true);
    setPaymentError('');
    try {
      await loadRazorpayCheckout();
      const Checkout = (window as any).Razorpay;
      const checkout = new Checkout({
        key: savedOrder.razorpayKeyId,
        amount: savedOrder.amount * 100,
        currency: 'INR',
        name: 'PICK//DROP',
        description: 'Snack vending order',
        order_id: savedOrder.razorpayOrderId,
        handler: () => {
          queryClient.invalidateQueries({ queryKey: getGetOrderStatusQueryKey(orderId) });
          setPaymentHandoff(false);
        },
        modal: { ondismiss: () => setPaymentHandoff(false) },
        theme: { color: '#087cf8' },
      });
      checkout.open();
    } catch (error) {
      setPaymentHandoff(false);
      setPaymentError(error instanceof Error ? error.message : 'Razorpay checkout could not open.');
    }
  };

  useEffect(() => {
    const refreshAfterPaymentApp = () => {
      if (orderId) queryClient.invalidateQueries({ queryKey: getGetOrderStatusQueryKey(orderId) });
      setPaymentHandoff(false);
    };
    window.addEventListener('pageshow', refreshAfterPaymentApp);
    document.addEventListener('visibilitychange', refreshAfterPaymentApp);
    return () => {
      window.removeEventListener('pageshow', refreshAfterPaymentApp);
      document.removeEventListener('visibilitychange', refreshAfterPaymentApp);
    };
  }, [orderId, queryClient]);

  return (
    <Shell>
      <main className="mx-auto max-w-[1120px] px-4 pb-28 pt-10 md:px-8 md:pb-14 md:pt-16">
        <div className="mx-auto max-w-3xl text-center rise-in"><p className="font-mono-ui text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">02 / live handoff</p><h1 className="mt-3 text-5xl font-extrabold tracking-[-.08em] md:text-7xl">Know exactly<br />where it is.</h1><p className="mx-auto mt-5 max-w-md text-[hsl(var(--muted-foreground))]">We keep checking the machine so you don’t have to stare at a payment screen.</p></div>
        {!orderId ? (
          <div className="mx-auto mt-12 max-w-lg rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-[var(--shadow-card)] md:p-8"><div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-[hsl(var(--accent))]"><Receipt size={22} /></div><h2 className="text-2xl font-extrabold tracking-[-.05em]">Find an order</h2><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Paste the order ID from your payment screen to resume tracking.</p><form onSubmit={(event) => { event.preventDefault(); setOrderId(manualId.trim()); }} className="mt-6 flex flex-col gap-3 sm:flex-row"><input value={manualId} onChange={(event) => setManualId(event.target.value)} data-testid="input-order-id" placeholder="e.g. PD-7F3A9" className="min-w-0 flex-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-3 font-mono-ui text-sm outline-none focus:border-[hsl(var(--primary))]" /><button type="submit" data-testid="button-track-order" className="pressable flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-5 py-3 text-sm font-bold text-[hsl(var(--background))]">Track order <ArrowRight size={15} /></button></form></div>
        ) : (
          <div className="mx-auto mt-12 grid max-w-4xl gap-5 lg:grid-cols-[1.15fr_.85fr]">
            <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-[var(--shadow-card)] md:p-8">
              <div className="flex items-start justify-between gap-3 border-b border-[hsl(var(--border))] pb-5"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">order reference</p><p className="mt-1 font-mono-ui text-lg font-bold" data-testid="text-order-id">{orderId}</p></div><div className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold ${dispensed ? 'bg-[hsl(var(--secondary)/.13)] text-[hsl(var(--secondary))]' : paid ? 'bg-[hsl(var(--accent)/.35)] text-[hsl(var(--foreground))]' : 'bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]'}`} data-testid="status-order"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" /> {statusLabel(status?.status)}</div></div>
              {statusQuery.isLoading ? <div className="space-y-5 py-10"><div className="h-5 w-1/3 animate-pulse rounded bg-[hsl(var(--muted))]" /><div className="h-3 animate-pulse rounded bg-[hsl(var(--muted))]" /><div className="h-3 w-4/5 animate-pulse rounded bg-[hsl(var(--muted))]" /></div> : statusQuery.isError ? <StateCard icon={<TriangleAlert size={22} />} title="Can’t reach the machine" body="We’ll try again when you refresh the signal." action={<button onClick={() => statusQuery.refetch()} data-testid="button-retry-status" className="pressable rounded-lg bg-[hsl(var(--foreground))] px-4 py-2 text-sm font-bold text-[hsl(var(--background))]">Retry status</button>} /> : (
                <div className="relative py-9"><div className="absolute left-[23px] top-12 h-[calc(100%-96px)] w-px bg-[hsl(var(--border))]" /><StatusStep number="01" title="Order created" copy="The machine has your selection." complete /><StatusStep number="02" title="Payment confirmed" copy={paid ? 'UPI payment received. Your snack is next.' : 'Open UPI below, then confirm payment.'} complete={paid} active={!paid} /><StatusStep number="03" title="Dispensing" copy={dispensed ? 'Your snack is waiting in the pickup bay.' : 'The motor starts as soon as payment clears.'} complete={dispensed} active={paid && !dispensed} /></div>
              )}
              {paymentError && <p className="mb-4 flex items-center gap-2 rounded-lg bg-[hsl(var(--destructive)/.1)] p-3 text-xs text-[hsl(var(--destructive))]" data-testid="error-razorpay-payment"><CircleAlert size={15} /> {paymentError}</p>}
              {!dispensed && <div className="flex flex-col gap-3 sm:flex-row"><button onClick={openRazorpayPayment} disabled={paymentHandoff || paid} data-testid="button-open-razorpay" className={`pressable flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-bold disabled:cursor-wait disabled:opacity-60 ${paid ? 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]' : 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[4px_4px_0_hsl(var(--foreground))]'}`}>{paymentHandoff ? <RefreshCw size={16} className="animate-spin" /> : paid ? <Check size={16} /> : <ExternalLink size={16} />} {paymentHandoff ? 'Opening Razorpay…' : paid ? 'Payment received' : 'Pay with Razorpay'}</button></div>}
            </div>
            <div className="flex flex-col gap-5">
              <div className="machine-grid scan-bar overflow-hidden rounded-3xl bg-[hsl(var(--foreground))] p-6 text-[hsl(var(--background))] md:p-7"><div className="relative"><div className="flex items-center justify-between"><span className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[hsl(var(--accent))]">machine telemetry</span><span className="font-mono-ui text-[10px] text-[hsl(var(--background)/.55)]">LIVE</span></div><div className="mt-12 grid grid-cols-2 gap-5"><div><p className="font-mono-ui text-[10px] uppercase text-[hsl(var(--background)/.55)]">status</p><p className="mt-1 text-xl font-bold">{dispensed ? 'BAY OPEN' : paid ? 'MOTOR READY' : 'STANDBY'}</p></div><div><p className="font-mono-ui text-[10px] uppercase text-[hsl(var(--background)/.55)]">order value</p><p className="mt-1 font-mono-ui text-xl font-bold">{savedOrder ? money(savedOrder.amount) : '—'}</p></div></div><div className="mt-9 border-t border-[hsl(var(--background)/.2)] pt-4 font-mono-ui text-[10px] text-[hsl(var(--background)/.55)]">AUTO REFRESH / 2.5 SEC</div></div></div>
              <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--accent)/.28)] p-6"><div className="flex items-center gap-2 text-[hsl(var(--foreground))]"><Sparkles size={17} /><span className="font-bold">Small promise</span></div><p className="mt-3 text-sm leading-relaxed text-[hsl(var(--foreground)/.75)]">If the bay doesn’t open after payment, keep this screen open and ask the floor team to quote your order reference.</p></div>
            </div>
          </div>
        )}
      </main>
    </Shell>
  );
}

function StatusStep({ number, title, copy, complete, active }: { number: string; title: string; copy: string; complete?: boolean; active?: boolean }) {
  return <div className="relative mb-8 flex gap-4 last:mb-0"><div className={`relative z-[1] grid h-12 w-12 shrink-0 place-items-center rounded-xl border ${complete ? 'border-[hsl(var(--secondary))] bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]' : active ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))]'}`}>{complete ? <Check size={19} /> : <span className="font-mono-ui text-xs">{number}</span>}</div><div className="pt-1"><h3 className={`font-bold ${active ? 'text-[hsl(var(--primary))]' : ''}`}>{title}</h3><p className="mt-1 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{copy}</p></div></div>;
}

function AdminPage() {
  const [key, setKey] = useState('dashboard');
  const summaryQuery = useGetAdminSummary({ key }, { query: { queryKey: getGetAdminSummaryQueryKey({ key }) } });
  const summary = summaryQuery.data;
  return (
    <Shell>
      <main className="mx-auto max-w-[1380px] px-4 pb-28 pt-9 md:px-8 md:pb-14 md:pt-12">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end"><div className="rise-in"><div className="mb-4 flex items-center gap-2 text-[hsl(var(--primary))]"><Layers3 size={15} /><span className="font-mono-ui text-[10px] font-bold uppercase tracking-[.2em]">operations console</span></div><h1 className="text-5xl font-extrabold tracking-[-.08em] md:text-7xl">The machine<br /><span className="text-[hsl(var(--secondary))]">at a glance.</span></h1><p className="mt-4 max-w-lg text-[hsl(var(--muted-foreground))]">Sales, payment flow, and shelf health in one quiet control room.</p></div><div className="flex items-center gap-2"><label className="font-mono-ui text-[10px] uppercase text-[hsl(var(--muted-foreground))]">Access key</label><input type="password" value={key} onChange={(event) => setKey(event.target.value)} data-testid="input-admin-key" className="w-28 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 font-mono-ui text-xs outline-none focus:border-[hsl(var(--primary))]" /></div></div>
        {summaryQuery.isLoading ? <AdminSkeleton /> : summaryQuery.isError ? <div className="mt-12"><StateCard icon={<TriangleAlert size={22} />} title="Console unavailable" body="The operations summary could not be loaded with that access key." action={<button onClick={() => summaryQuery.refetch()} data-testid="button-retry-admin" className="pressable rounded-lg bg-[hsl(var(--foreground))] px-4 py-2 text-sm font-bold text-[hsl(var(--background))]">Retry summary</button>} /></div> : summary ? (
          <div className="mt-12">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Revenue" value={money(summary.totalRevenue)} hint="all-time gross" icon={<WalletCards size={18} />} accent="primary" />
              <MetricCard label="Orders" value={String(summary.totalOrders)} hint="completed checkouts" icon={<Receipt size={18} />} accent="dark" />
              <MetricCard label="Pending" value={String(summary.pendingOrders)} hint="need attention" icon={<Clock3 size={18} />} accent="yellow" />
              <MetricCard label="Dispensed" value={String(summary.dispensedOrders)} hint="successful handoffs" icon={<PackageCheck size={18} />} accent="teal" />
            </section>
            <section className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
              <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 md:p-7"><div className="flex items-start justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">sales mix</p><h2 className="mt-2 text-2xl font-extrabold tracking-[-.05em]">What moves fastest</h2></div><BarChart3 size={20} className="text-[hsl(var(--primary))]" /></div><div className="mt-8 space-y-5">{(summary.perProduct || []).length ? summary.perProduct.map((item, index) => { const max = Math.max(...summary.perProduct.map((line) => line.qtySold), 1); return <div key={item.name} data-testid={`row-sales-${index}`}><div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="font-bold">{item.name}</span><span className="font-mono-ui text-xs text-[hsl(var(--muted-foreground))]">{item.qtySold} sold / {money(item.revenue)}</span></div><div className="h-3 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className={`h-full rounded-full ${index % 2 ? 'bg-[hsl(var(--secondary))]' : 'bg-[hsl(var(--primary))]'}`} style={{ width: `${Math.max(6, (item.qtySold / max) * 100)}%` }} /></div></div>; }) : <StateCard icon={<BarChart3 size={20} />} title="No sales yet" body="Sales will appear here once the first snack is dispensed." />}</div></div>
              <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--foreground))] p-5 text-[hsl(var(--background))] md:p-7"><div className="flex items-start justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[hsl(var(--accent))]">shelf scan</p><h2 className="mt-2 text-2xl font-extrabold tracking-[-.05em]">Current stock</h2></div><Tag size={20} className="text-[hsl(var(--accent))]" /></div><div className="mt-7 space-y-3">{(summary.currentStock || []).map((product) => <div key={product.id} className="flex items-center gap-3 rounded-xl border border-[hsl(var(--background)/.14)] px-3 py-3" data-testid={`row-stock-${product.id}`}><span className={`grid h-8 w-8 place-items-center rounded-lg text-xs font-bold ${product.stock <= 2 ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--background)/.12)]'}`}>{product.stock}</span><span className="min-w-0 flex-1 truncate text-sm font-bold">{product.name}</span><span className={`font-mono-ui text-[10px] uppercase ${product.stock <= 2 ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--background)/.55)]'}`}>{product.stock <= 2 ? 'restock' : 'ready'}</span></div>)}{!(summary.currentStock || []).length && <p className="py-5 text-sm text-[hsl(var(--background)/.6)]">No stock data returned.</p>}</div></div>
            </section>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--accent)/.22)] px-5 py-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-[hsl(var(--accent))]"><CircleCheck size={18} /></div><div><p className="text-sm font-bold">System health looks good</p><p className="text-xs text-[hsl(var(--muted-foreground))]">Inventory and payment services are reporting normally.</p></div></div><button onClick={() => summaryQuery.refetch()} data-testid="button-refresh-admin" className="pressable flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold"><RefreshCw size={13} /> Refresh data</button></div>
          </div>
        ) : <StateCard icon={<Gauge size={22} />} title="Nothing to show" body="The machine returned an empty operations report." />}
      </main>
    </Shell>
  );
}

function MetricCard({ label, value, hint, icon, accent }: { label: string; value: string; hint: string; icon: React.ReactNode; accent: string }) {
  const backgrounds: Record<string, string> = { primary: 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]', dark: 'bg-[hsl(var(--foreground))] text-[hsl(var(--background))]', yellow: 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]', teal: 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]' };
  return <div className={`rounded-2xl p-5 shadow-[var(--shadow-card)] ${backgrounds[accent]}`} data-testid={`metric-${label.toLowerCase()}`}><div className="flex items-center justify-between"><span className="font-mono-ui text-[10px] uppercase tracking-[.16em] opacity-70">{label}</span><span className="opacity-80">{icon}</span></div><p className="mt-7 font-mono-ui text-3xl font-bold tracking-[-.06em]">{value}</p><p className="mt-1 text-xs opacity-70">{hint}</p></div>;
}

function AdminSkeleton() {
  return <div className="mt-12 animate-pulse"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-36 rounded-2xl bg-[hsl(var(--muted))]" />)}</div><div className="mt-5 grid gap-5 lg:grid-cols-2"><div className="h-80 rounded-3xl bg-[hsl(var(--muted))]" /><div className="h-80 rounded-3xl bg-[hsl(var(--muted))]" /></div></div>;
}

function Router() {
  const [location] = useLocation();
  useEffect(() => {
    const pageTitle = location === '/admin' ? 'Operations Console — PICK//DROP' : location === '/status' ? 'Track your order — PICK//DROP' : 'PICK//DROP — Fast snacks, zero small talk';
    document.title = pageTitle;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', 'Choose a snack, pay by UPI, and watch PICK//DROP dispense it in real time.');
  }, [location]);
  return <ErrorBoundary resetKey={location}><Switch><Route path="/" component={Home} /><Route path="/status" component={StatusPage} /><Route path="/admin" component={AdminPage} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;