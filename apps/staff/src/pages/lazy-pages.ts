import { lazy } from 'react';

// The waiter's screens (floor, order) are in the main bundle so they open instantly; everything
// else loads on first use (Phase 10 performance pass).
export const LocationsPage = lazy(() =>
  import('./LocationsPage').then((m) => ({ default: m.LocationsPage })),
);
export const MenuPage = lazy(() =>
  import('./menu/MenuPage').then((m) => ({ default: m.MenuPage })),
);
export const FloorEditorPage = lazy(() =>
  import('./floor/FloorEditorPage').then((m) => ({ default: m.FloorEditorPage })),
);
export const QrSheetPage = lazy(() =>
  import('./floor/QrSheetPage').then((m) => ({ default: m.QrSheetPage })),
);
export const KdsPage = lazy(() => import('./kds/KdsPage').then((m) => ({ default: m.KdsPage })));
export const CashierPage = lazy(() =>
  import('./cashier/CashierPage').then((m) => ({ default: m.CashierPage })),
);
export const DevicesPage = lazy(() =>
  import('./settings/DevicesPage').then((m) => ({ default: m.DevicesPage })),
);
export const InventoryPage = lazy(() =>
  import('./inventory/InventoryPage').then((m) => ({ default: m.InventoryPage })),
);
export const ReservationsPage = lazy(() =>
  import('./reservations/ReservationsPage').then((m) => ({ default: m.ReservationsPage })),
);
export const DashboardPage = lazy(() =>
  import('./reports/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
export const ReportsPage = lazy(() =>
  import('./reports/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
export const AuditPage = lazy(() =>
  import('./audit/AuditPage').then((m) => ({ default: m.AuditPage })),
);
export const OrdersPage = lazy(() =>
  import('./orders/OrdersPage').then((m) => ({ default: m.OrdersPage })),
);
export const SettingsPage = lazy(() =>
  import('./SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
export const ShowcasePage = lazy(() =>
  import('./ShowcasePage').then((m) => ({ default: m.ShowcasePage })),
);
export const StaffPage = lazy(() =>
  import('./staff/StaffPage').then((m) => ({ default: m.StaffPage })),
);
export const BillPage = lazy(() =>
  import('./billing/BillPage').then((m) => ({ default: m.BillPage })),
);
export const SessionBill = lazy(() =>
  import('./billing/BillPage').then((m) => ({ default: m.SessionBill })),
);
