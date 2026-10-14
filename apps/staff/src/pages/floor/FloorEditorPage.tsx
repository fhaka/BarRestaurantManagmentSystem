import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Pencil, Plus, QrCode, RefreshCw, RotateCw, Trash2 } from 'lucide-react';
import {
  FLOOR_GRID,
  SHAPE_SIZE,
  TABLE_SHAPES,
  rectInGrid,
  rectsOverlap,
  type Area,
  type FloorState,
  type FloorTable,
  type Rect,
  type TableShape,
} from '@tavolina/shared';
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  toast,
} from '@tavolina/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useSession } from '../../lib/session';
import { FloorCanvas, TableShapeView } from './FloorCanvas';
import { useFloorQuery } from './floor-utils';

type Geometry = Rect & { rotation: number };

/** First free spot (row by row) where a table of this size fits without overlapping. */
function findFreeSpot(size: { w: number; h: number }, taken: Rect[]): Rect | null {
  for (let y = 1; y + size.h <= FLOOR_GRID.rows; y++) {
    for (let x = 1; x + size.w <= FLOOR_GRID.cols; x++) {
      const rect = { x, y, ...size };
      if (
        !taken.some((t) =>
          rectsOverlap(t, { x: rect.x - 1, y: rect.y - 1, w: rect.w + 2, h: rect.h + 2 }),
        )
      )
        return rect;
    }
  }
  return null;
}

function nextTableName(tables: FloorTable[]): string {
  const numbers = tables
    .map((t) => Number(t.name.replace(/\D/g, '')))
    .filter((n) => Number.isFinite(n));
  return String((numbers.length ? Math.max(...numbers) : 0) + 1);
}

export function FloorEditorPage() {
  const { t } = useTranslation('floor');
  const { message } = useErrorMessages();
  const queryClient = useQueryClient();
  const locationId = useSession((s) => s.locationId);
  const floor = useFloorQuery();
  const [areaId, setAreaId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Map<number, Geometry>>(new Map());
  const [conflict, setConflict] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [areaDialog, setAreaDialog] = useState<{ open: boolean; area: Area | null }>({
    open: false,
    area: null,
  });
  const [confirm, setConfirm] = useState<null | 'deleteArea' | 'deleteTable' | 'rotateQr'>(null);
  const drag = useRef<{
    id: number;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origin: Geometry;
    last: Geometry;
    cell: number;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  const data = floor.data;
  const areas = data?.areas ?? [];
  const currentAreaId = areaId ?? areas[0]?.id ?? null;
  const currentArea = areas.find((a) => a.id === currentAreaId) ?? null;

  const geometry = (table: FloorTable): Geometry =>
    drafts.get(table.id) ?? {
      x: table.x,
      y: table.y,
      w: table.w,
      h: table.h,
      rotation: table.rotation,
    };
  const areaTables = useMemo(
    () => (data?.tables ?? []).filter((x) => x.areaId === currentAreaId),
    [data, currentAreaId],
  );
  const selected = areaTables.find((x) => x.id === selectedId) ?? null;
  const dirtyInArea = areaTables.filter((x) => drafts.has(x.id));

  const setFloor = (next: FloorState) => queryClient.setQueryData(['floor', locationId], next);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['floor'] });

  const overlaps = (id: number, rect: Rect) =>
    areaTables.some((other) => other.id !== id && rectsOverlap(rect, geometry(other)));

  function update(id: number, next: Geometry) {
    setDrafts((d) => new Map(d).set(id, next));
  }

  // ---- Pointer drag (move / resize), snapped to the grid ----
  function onPointerDown(
    e: PointerEvent,
    table: FloorTable,
    mode: 'move' | 'resize',
    cell: number,
  ) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelectedId(table.id);
    const origin = geometry(table);
    drag.current = {
      id: table.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origin,
      last: origin,
      cell,
    };
    setDraggingId(table.id);
  }

  function onPointerMove(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = Math.round((e.clientX - d.startX) / d.cell);
    const dy = Math.round((e.clientY - d.startY) / d.cell);
    const o = d.origin;
    const next =
      d.mode === 'move'
        ? {
            ...o,
            x: Math.min(Math.max(0, o.x + dx), FLOOR_GRID.cols - o.w),
            y: Math.min(Math.max(0, o.y + dy), FLOOR_GRID.rows - o.h),
          }
        : {
            ...o,
            w: Math.min(Math.max(1, o.w + dx), 16, FLOOR_GRID.cols - o.x),
            h: Math.min(Math.max(1, o.h + dy), 16, FLOOR_GRID.rows - o.y),
          };
    d.last = next;
    setConflict(overlaps(d.id, next) ? d.id : null);
    update(d.id, next);
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    setDraggingId(null);
    if (!d) return;
    if (overlaps(d.id, d.last)) {
      // Snap back: tables may not overlap.
      update(d.id, d.origin);
      toast.error(t('editor.overlap'));
    }
    setConflict(null);
  }

  // ---- Keyboard: arrows move, Shift+arrows resize, R rotates (accessible alternative to dragging) ----
  function onKeyDown(e: KeyboardEvent, table: FloorTable) {
    const g = geometry(table);
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    let next: Geometry | null = null;
    if (step[e.key]) {
      const [dx, dy] = step[e.key]!;
      next = e.shiftKey
        ? { ...g, w: Math.max(1, Math.min(16, g.w + dx)), h: Math.max(1, Math.min(16, g.h + dy)) }
        : { ...g, x: g.x + dx, y: g.y + dy };
    } else if (e.key === 'r' || e.key === 'R') {
      next = { ...g, rotation: (g.rotation + 45) % 360 };
    }
    if (!next) return;
    e.preventDefault();
    if (!rectInGrid(next) || overlaps(table.id, next)) return;
    update(table.id, next);
  }

  async function saveLayout() {
    if (!currentAreaId) return;
    setSaving(true);
    try {
      const next = await api<FloorState>('POST', '/tables/layout', {
        body: {
          areaId: currentAreaId,
          tables: dirtyInArea.map((x) => ({ id: x.id, ...geometry(x) })),
        },
      });
      setFloor(next);
      setDrafts((d) => {
        const copy = new Map(d);
        for (const x of dirtyInArea) copy.delete(x.id);
        return copy;
      });
      toast.success(t('editor.saved'));
    } catch (err) {
      toast.error(message(err));
    } finally {
      setSaving(false);
    }
  }

  async function addTable(shape: TableShape) {
    if (!currentAreaId) return;
    const spot = findFreeSpot(SHAPE_SIZE[shape], areaTables.map(geometry));
    if (!spot) return toast.error(t('editor.noSpace'));
    const name = nextTableName(data?.tables ?? []);
    try {
      const created = await api<FloorTable>('POST', '/tables', {
        body: {
          areaId: currentAreaId,
          name,
          shape,
          seats: shape === 'bar_stool' ? 1 : shape === 'rectangle' ? 6 : 4,
          ...spot,
        },
      });
      await refresh();
      setSelectedId(created.id);
      toast.success(t('editor.tableAdded', { name }));
    } catch (err) {
      toast.error(message(err));
    }
  }

  async function run(work: () => Promise<unknown>, success?: string) {
    try {
      await work();
      await refresh();
      if (success) toast.success(success);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setConfirm(null);
    }
  }

  if (floor.isPending) return <Skeleton className="m-8 h-[70dvh] rounded-card" />;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-6 pb-28 sm:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <Link
            to="/floor"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t('editor.back')}
          </Link>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {t('editor.title')}
          </h1>
          <p className="text-foreground-muted">{t('editor.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {currentArea ? (
            <Button asChild variant="outline">
              <Link to={`/floor/qr/${currentArea.id}`}>
                <QrCode />
                {t('editor.qrSheet')}
              </Link>
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setAreaDialog({ open: true, area: null })}>
            <Plus />
            {t('editor.addArea')}
          </Button>
        </div>
      </div>

      {areas.length === 0 ? (
        <EmptyState
          title={t('editor.noAreasTitle')}
          description={t('editor.noAreasDescription')}
          action={
            <Button onClick={() => setAreaDialog({ open: true, area: null })}>
              <Plus />
              {t('editor.addArea')}
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs
              value={String(currentAreaId)}
              onValueChange={(v) => {
                setAreaId(Number(v));
                setSelectedId(null);
              }}
              className="min-w-0 flex-1"
            >
              <TabsList>
                {areas.map((a) => (
                  <TabsTrigger key={a.id} value={String(a.id)}>
                    {a.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {currentArea ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAreaDialog({ open: true, area: currentArea })}
                >
                  <Pencil />
                  {t('editor.renameArea')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  onClick={() => setConfirm('deleteArea')}
                >
                  <Trash2 />
                  {t('editor.deleteArea')}
                </Button>
              </>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <FloorCanvas
              cols={FLOOR_GRID.cols}
              rows={FLOOR_GRID.rows}
              showGrid
              onBackgroundPointerDown={() => setSelectedId(null)}
            >
              {(cell) =>
                areaTables.map((table) => {
                  const g = geometry(table);
                  const isSelected = table.id === selectedId;
                  return (
                    <div
                      key={table.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${t('table.title', { name: table.name })}, ${t('seats', { count: table.seats })}`}
                      aria-pressed={isSelected}
                      onPointerDown={(e) => onPointerDown(e, table, 'move', cell)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                      onFocus={() => setSelectedId(table.id)}
                      onKeyDown={(e) => onKeyDown(e, table)}
                      className={cn(
                        'absolute touch-none select-none outline-hidden',
                        draggingId === table.id ? 'z-20 cursor-grabbing' : 'cursor-grab',
                        !table.active && 'opacity-50',
                      )}
                      style={{
                        left: g.x * cell,
                        top: g.y * cell,
                        width: g.w * cell,
                        height: g.h * cell,
                      }}
                    >
                      <TableShapeView
                        shape={table.shape}
                        rotation={g.rotation}
                        className={cn(
                          'bg-surface shadow-raised',
                          conflict === table.id
                            ? 'border-danger bg-danger-soft'
                            : isSelected
                              ? 'border-primary bg-primary-soft ring-2 ring-primary/30'
                              : 'border-border-strong',
                        )}
                      />
                      <span className="relative flex h-full flex-col items-center justify-center text-center leading-tight">
                        <span className="text-sm font-extrabold">{table.name}</span>
                        {Math.min(g.w, g.h) * cell >= 48 ? (
                          <span className="text-[10px] text-foreground-muted">
                            {t('seats', { count: table.seats })}
                          </span>
                        ) : null}
                      </span>
                      {isSelected ? (
                        <span
                          aria-label={t('editor.resize')}
                          role="presentation"
                          onPointerDown={(e) => onPointerDown(e, table, 'resize', cell)}
                          onPointerMove={onPointerMove}
                          onPointerUp={onPointerUp}
                          className="absolute -bottom-1.5 -right-1.5 size-4 cursor-nwse-resize rounded-xs border-2 border-surface bg-primary"
                        />
                      ) : null}
                    </div>
                  );
                })
              }
            </FloorCanvas>

            <aside className="flex flex-col gap-4">
              <Card className="flex flex-col gap-3 p-4">
                <h2 className="text-sm font-bold uppercase tracking-wider text-foreground-muted">
                  {t('editor.addTable')}
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {TABLE_SHAPES.map((shape) => (
                    <Button key={shape} variant="outline" onClick={() => addTable(shape)}>
                      <span
                        aria-hidden
                        className={cn(
                          'inline-block border-2 border-current',
                          shape === 'round' || shape === 'bar_stool'
                            ? 'rounded-full'
                            : 'rounded-[3px]',
                          shape === 'rectangle'
                            ? 'h-3 w-5'
                            : shape === 'bar_stool'
                              ? 'size-2.5'
                              : 'size-3.5',
                        )}
                      />
                      {t(`editor.shapes.${shape}`)}
                    </Button>
                  ))}
                </div>
              </Card>

              {selected ? (
                <TableProperties
                  key={selected.id}
                  table={selected}
                  geometry={geometry(selected)}
                  onRotate={() => {
                    const g = geometry(selected);
                    update(selected.id, { ...g, rotation: (g.rotation + 45) % 360 });
                  }}
                  onSaved={refresh}
                  onDelete={() => setConfirm('deleteTable')}
                  onRotateQr={() => setConfirm('rotateQr')}
                />
              ) : (
                <p className="rounded-card border border-dashed border-border-strong p-4 text-sm text-foreground-muted">
                  {t('editor.selectHint')}
                </p>
              )}
            </aside>
          </div>
        </>
      )}

      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur-sm transition-transform lg:left-[272px]',
          dirtyInArea.length ? 'translate-y-0' : 'translate-y-full',
        )}
        aria-hidden={!dirtyInArea.length}
      >
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <span className="text-sm font-medium text-foreground-muted">{t('editor.unsaved')}</span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              tabIndex={dirtyInArea.length ? 0 : -1}
              onClick={() =>
                setDrafts((d) => {
                  const copy = new Map(d);
                  for (const x of dirtyInArea) copy.delete(x.id);
                  return copy;
                })
              }
            >
              {t('editor.discard')}
            </Button>
            <Button loading={saving} tabIndex={dirtyInArea.length ? 0 : -1} onClick={saveLayout}>
              {t('editor.save')}
            </Button>
          </div>
        </div>
      </div>

      <AreaDialog
        state={areaDialog}
        onClose={() => setAreaDialog({ open: false, area: null })}
        onSaved={async (area) => {
          await refresh();
          setAreaId(area.id);
        }}
      />
      <ConfirmDialog
        open={confirm === 'deleteArea'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('editor.deleteAreaConfirm', { name: currentArea?.name ?? '' })}
        description={t('editor.deleteAreaDescription')}
        confirmLabel={t('editor.deleteArea')}
        onConfirm={() =>
          run(async () => {
            await api('DELETE', `/areas/${currentAreaId}`);
            setAreaId(null);
          })
        }
      />
      <ConfirmDialog
        open={confirm === 'deleteTable'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('editor.deleteTableConfirm', { name: selected?.name ?? '' })}
        description={t('editor.deleteTableDescription')}
        confirmLabel={t('editor.deleteTable')}
        onConfirm={() =>
          run(async () => {
            await api('DELETE', `/tables/${selectedId}`);
            setSelectedId(null);
          })
        }
      />
      <ConfirmDialog
        open={confirm === 'rotateQr'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('editor.rotateQrConfirm', { name: selected?.name ?? '' })}
        description={t('editor.rotateQrDescription')}
        confirmLabel={t('editor.rotateQr')}
        onConfirm={() =>
          run(() => api('POST', `/tables/${selectedId}/qr/rotate`), t('editor.qrRotated'))
        }
      />
    </div>
  );
}

function TableProperties({
  table,
  geometry,
  onRotate,
  onSaved,
  onDelete,
  onRotateQr,
}: {
  table: FloorTable;
  geometry: Geometry;
  onRotate: () => void;
  onSaved: () => void;
  onDelete: () => void;
  onRotateQr: () => void;
}) {
  const { t } = useTranslation('floor');
  const { message } = useErrorMessages();
  const [name, setName] = useState(table.name);
  const [seats, setSeats] = useState(String(table.seats));
  const [shape, setShape] = useState<TableShape>(table.shape);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api('PATCH', `/tables/${table.id}`, {
        body: { name, seats: Number(seats) || 1, shape },
      });
      onSaved();
      toast.success(t('table.saved'));
    } catch (err) {
      toast.error(message(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider text-foreground-muted">
        {t('editor.selected')}
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('editor.name')}>
          <Input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('editor.seats')}>
          <Input
            inputMode="numeric"
            value={seats}
            onChange={(e) => setSeats(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
      </div>
      <Field label={t('editor.shape')}>
        <Select
          value={shape}
          onValueChange={(v) => setShape(v as TableShape)}
          options={TABLE_SHAPES.map((s) => ({ value: s, label: t(`editor.shapes.${s}`) }))}
        />
      </Field>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-foreground-muted">
          {t('editor.rotation')}:{' '}
          <span className="font-mono tabular-nums">{geometry.rotation}°</span> · {geometry.w}×
          {geometry.h}
        </span>
        <Button variant="outline" size="sm" onClick={onRotate}>
          <RotateCw />
          {t('editor.rotate')}
        </Button>
      </div>
      <Button onClick={save} loading={saving}>
        {t('editor.saveTable')}
      </Button>
      <div className="flex flex-col gap-1 border-t border-border pt-3">
        <Button variant="ghost" size="sm" className="justify-start" onClick={onRotateQr}>
          <RefreshCw />
          {t('editor.rotateQr')}
        </Button>
        <Button variant="ghost" size="sm" className="justify-start text-danger" onClick={onDelete}>
          <Trash2 />
          {t('editor.deleteTable')}
        </Button>
      </div>
    </Card>
  );
}

function AreaDialog({
  state,
  onClose,
  onSaved,
}: {
  state: { open: boolean; area: Area | null };
  onClose: () => void;
  onSaved: (area: Area) => void;
}) {
  const { t } = useTranslation('floor');
  const { t: tc } = useTranslation();
  return (
    <Dialog open={state.open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={tc('actions.close')} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{state.area ? t('editor.renameArea') : t('editor.addArea')}</DialogTitle>
        </DialogHeader>
        <AreaForm
          key={state.area?.id ?? 'new'}
          area={state.area}
          onClose={onClose}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

function AreaForm({
  area,
  onClose,
  onSaved,
}: {
  area: Area | null;
  onClose: () => void;
  onSaved: (area: Area) => void;
}) {
  const { t } = useTranslation('floor');
  const { t: tc } = useTranslation();
  const { message } = useErrorMessages();
  const { t: te } = useTranslation('errors');
  const [name, setName] = useState(area?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return setError(te('fields.required'));
    setSaving(true);
    try {
      const saved = area
        ? await api<Area>('PATCH', `/areas/${area.id}`, { body: { name } })
        : await api<Area>('POST', '/areas', { body: { name } });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-5"
    >
      <Field label={t('editor.areaName')} error={error ?? undefined}>
        <Input
          value={name}
          placeholder={t('editor.areaNamePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {tc('actions.cancel')}
        </Button>
        <Button type="submit" loading={saving}>
          {tc('actions.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
