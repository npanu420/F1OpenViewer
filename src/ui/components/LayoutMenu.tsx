import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LayoutDashboard, PencilRuler } from 'lucide-react';
import { useLocale } from '../../i18n/LocaleContext';
import type { SavedGrid } from './MultiViewer';
import { SavedLayoutsContent } from './MultiViewerCommandBar';

interface LayoutMenuProps {
  autoLayout: boolean;
  onToggleAuto: () => void;
  showNames: boolean;
  onToggleNames: () => void;
  onEdit: () => void;
  savedGrids: SavedGrid[];
  onSaveLayout: (name: string) => void;
  onApplyLayout: (preset: SavedGrid) => void;
  onDeleteLayout: (id: string) => void;
}

/** Layout options in one menu: auto layout, names, edit mode and saved layouts. */
export function LayoutMenu({ autoLayout, onToggleAuto, showNames, onToggleNames, onEdit, savedGrids, onSaveLayout, onApplyLayout, onDeleteLayout }: LayoutMenuProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      rootRef.current?.querySelector('button')?.focus();
    };
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const switchRow = (label: string, hint: string, on: boolean, toggle: () => void) => (
    <button type="button" role="switch" aria-checked={on} className="layout-menu-row" onClick={toggle}>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <span className="ui-switch" data-on={on ? 'true' : undefined} aria-hidden />
    </button>
  );

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button type="button" className="ui-button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <LayoutDashboard className="w-4 h-4" aria-hidden />
        {t('experience.layoutMenu')}
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="layout-menu thin-scrollbar">
          {switchRow(t('experience.autoLayout'), t('experience.autoLayoutHint'), autoLayout, onToggleAuto)}
          {switchRow(t('experience.showNames'), t('experience.showNamesHint'), showNames, onToggleNames)}
          <button type="button" className="layout-menu-row" onClick={() => { setOpen(false); onEdit(); }}>
            <PencilRuler className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-sm">{t('experience.editLayout')}</span>
              <span className="block text-xs text-muted-foreground">{t('experience.editLayoutHint')}</span>
            </span>
          </button>
          <div className="panel-menu-separator" />
          <h3 className="stream-picker-heading">{t('dashboard.savedLayouts')}</h3>
          <SavedLayoutsContent savedGrids={savedGrids} onSave={onSaveLayout} onApply={(preset) => { onApplyLayout(preset); setOpen(false); }} onDelete={onDeleteLayout} />
        </div>
      )}
    </div>
  );
}
