import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { AppShell } from './components/AppShell';
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
import { LocationsPage } from './pages/LocationsPage';
import { MenuPage } from './pages/menu/MenuPage';
import { FloorEditorPage } from './pages/floor/FloorEditorPage';
import { FloorPage } from './pages/floor/FloorPage';
import { QrSheetPage } from './pages/floor/QrSheetPage';
import { KdsPage } from './pages/kds/KdsPage';
import { LockPage } from './pages/LockPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrderPage } from './pages/orders/OrderPage';
import { OrdersPage } from './pages/orders/OrdersPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShowcasePage } from './pages/ShowcasePage';
import { StaffPage } from './pages/staff/StaffPage';

// Screens built in later phases: reachable (with permission checks) but showing a placeholder.
const BUILT: ReadonlySet<string> = new Set([
  'staff',
  'locations',
  'settings',
  'menu',
  'floor',
  'orders',
  'kds',
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
  ? [{ element: <AppShell />, children: [{ path: 'dev/showcase', element: <ShowcasePage /> }] }]
  : [];

export const router = createBrowserRouter([
  {
    element: <SessionBoot />,
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
                <KdsPage />
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
