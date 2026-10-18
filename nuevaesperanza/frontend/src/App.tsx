import { Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { CartDrawer } from './components/CartDrawer'
import { RequireAuth } from './components/RequireAuth'
import { HomePage } from './pages/HomePage'
import { CatalogPage } from './pages/CatalogPage'
import { ProductPage } from './pages/ProductPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { LoginPage, RegisterPage } from './pages/AuthPages'
import { AccountPage } from './pages/AccountPage'
import { OrderPage } from './pages/OrderPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { AdminLayout } from './pages/admin/AdminLayout'
import { DashboardPage } from './pages/admin/DashboardPage'
import { ProductsAdminPage } from './pages/admin/ProductsAdminPage'
import { OrdersAdminPage } from './pages/admin/OrdersAdminPage'
import { useTheme } from './lib/theme'

function StoreLayout() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo({ top: 0 }) }, [pathname])
  return (
    <>
      <a href="#main" className="sr-only">Saltar al contenido</a>
      <Header />
      <main id="main"><Outlet /></main>
      <Footer />
      <CartDrawer />
    </>
  )
}

export function App() {
  useTheme()
  return (
    <Routes>
      <Route element={<StoreLayout />}>
        <Route index element={<HomePage />} />
        <Route path="productos" element={<CatalogPage />} />
        <Route path="producto/:slug" element={<ProductPage />} />
        <Route path="ingresar" element={<LoginPage />} />
        <Route path="registrarse" element={<RegisterPage />} />
        <Route path="checkout" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
        <Route path="mi-cuenta" element={<RequireAuth><AccountPage /></RequireAuth>} />
        <Route path="pedidos/:id" element={<RequireAuth><OrderPage /></RequireAuth>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="admin" element={<RequireAuth admin><AdminLayout /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="productos" element={<ProductsAdminPage />} />
        <Route path="pedidos" element={<OrdersAdminPage />} />
      </Route>
    </Routes>
  )
}
