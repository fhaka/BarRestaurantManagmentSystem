import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { AppShell } from './components/AppShell';
import { RootError, RouteBoundary } from './components/RouteBoundary';
import {
  HomeRedirect,
  NoAccess,
  RedirectIfAuthenticated,
  RequireLocked,
  RequirePermission,
  RequireSession,
  SessionBoot,
} from './components/guards';
import { NAV_ITEMS } from './nav';
import {
  AuditPage,
  BillPage,
  CashierPage,
  DashboardPage,
  DevicesPage,
  FloorEditorPage,
  InventoryPage,
  KdsPage,
  LocationsPage,
  MenuPage,
  OrdersPage,
  QrSheetPage,
  ReportsPage,
  ReservationsPage,
  SessionBill,
  SettingsPage,
  ShowcasePage,
  StaffPage,
} from './pages/lazy-pages';
import { FloorPage } from './pages/floor/FloorPage';
import { LockPage } from './pages/LockPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrderPage } from './pages/orders/OrderPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

// Screens built in later phases: reachable (with permission checks) but showing a placeholder.
const BUILT: ReadonlySet<string> = new Set([
  'staff',
  'locations',
  'settings',
  'menu',
  'floor',
  'orders',
  'kds',
  'cashier',
  'inventory',
  'reservations',
  'dashboard',
  'reports',
  'audit',
]);
const placeholderRoutes: RouteObject[] = NAV_ITEMS.filter((item) => !BUILT.has(item.key)).map(
  (item) => ({
    path: item.path.slice(1),
    element: (
      <RequirePermission permission={item.permission}>
        <PlaceholderPage item={item} />
      </RequirePermission>
    ),
  }),
);

// The component showcase is a development tool only.
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        element: <AppShell />,
        children: [
          {
            path: 'dev/showcase',
            element: (
              <RouteBoundary>
                <ShowcasePage />
              </RouteBoundary>
            ),
          },
        ],
      },
    ]
  : [];

export const router = createBrowserRouter([
  {
    element: <SessionBoot />,
    errorElement: <RootError />,
    children: [
      {
        path: 'login',
        element: (
          <RedirectIfAuthenticated>
            <LoginPage />
          </RedirectIfAuthenticated>
        ),
      },
      {
        path: 'lock',
        element: (
          <RequireLocked>
            <LockPage />
          </RequireLocked>
        ),
      },
      ...devRoutes,
      {
        element: <RequireSession />,
        children: [
          // The kitchen screen is full-screen, outside the normal layout.
          {
            path: 'kds',
            element: (
              <RequirePermission permission="kds.view">
                <RouteBoundary>
                  <KdsPage />
                </RouteBoundary>
              </RequirePermission>
            ),
          },
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <HomeRedirect /> },
              {
                path: 'staff',
                element: (
                  <RequirePermission permission="staff.view">
                    <StaffPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'floor',
                element: (
                  <RequirePermission permission="floor.view">
                    <FloorPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'floor/edit',
                element: (
                  <RequirePermission permission="floor.edit">
                    <FloorEditorPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'floor/qr/:areaId',
                element: (
                  <RequirePermission permission="floor.edit">
                    <QrSheetPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'floor/sessions/:sessionId',
                element: (
                  <RequirePermission permission="order.create">
                    <OrderPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'orders',
                element: (
                  <RequirePermission permission="order.create">
                    <OrdersPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'floor/sessions/:sessionId/bill',
                element: (
                  <RequirePermission permission="payment.take">
                    <SessionBill />
                  </RequirePermission>
                ),
              },
              {
                path: 'orders/:orderRef/bill',
                element: (
                  <RequirePermission permission="payment.take">
                    <BillPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'cashier',
                element: (
                  <RequirePermission permission="payment.take">
                    <CashierPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'settings/devices',
                element: (
                  <RequirePermission permission="settings.edit">
                    <DevicesPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'orders/:orderRef',
                element: (
                  <RequirePermission permission="order.create">
                    <OrderPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'menu',
                element: (
                  <RequirePermission permission="menu.edit">
                    <MenuPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'audit',
                element: (
                  <RequirePermission permission="audit.view">
                    <AuditPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'dashboard',
                element: (
                  <RequirePermission permission="report.view">
                    <DashboardPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'reports',
                element: (
                  <RequirePermission permission="report.view">
                    <ReportsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'reservations',
                element: (
                  <RequirePermission permission="reservation.view">
                    <ReservationsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'inventory',
                element: (
                  <RequirePermission permission="inventory.view">
                    <InventoryPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'locations',
                element: (
                  <RequirePermission permission="location.manage">
                    <LocationsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'settings',
                element: (
                  <RequirePermission permission="settings.edit">
                    <SettingsPage />
                  </RequirePermission>
                ),
              },
              ...placeholderRoutes,
              { path: 'no-access', element: <NoAccess /> },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
]);
