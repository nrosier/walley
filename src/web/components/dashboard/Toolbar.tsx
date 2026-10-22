import { Loader2 } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { syncDashboardMessages } from '@/pages/SyncDashboard.messages';
import { Button } from '../ui/button';

export interface ToolbarProps {
  query: string;
  showIgnored: boolean;
  running: boolean;
  onQueryChange?: (query: string) => void;
  onShowIgnoredChange?: (on: boolean) => void;
  onRun?: () => void;
}

/** One toolbar above both columns: search, Show Ignored Items switch, Run Sync Check. */
export function Toolbar(props: ToolbarProps) {
  const { t } = useT(syncDashboardMessages);
  return (
    <div role="group" aria-label={t('toolbar.label')} className="mb-3 flex flex-wrap items-center gap-3">
      <input
        type="search"
        value={props.query}
        aria-label={t('toolbar.search')}
        placeholder={t('toolbar.searchPlaceholder')}
        onChange={(e) => props.onQueryChange?.(e.target.value)}
        className="h-8 w-56 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <label className="flex items-center gap-2 text-sm">
        <button
          type="button"
          role="switch"
          aria-checked={props.showIgnored}
          onClick={() => props.onShowIgnoredChange?.(!props.showIgnored)}
          className={cn(
            'relative h-5 w-9 shrink-0 rounded-full border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            props.showIgnored ? 'bg-primary' : 'bg-neutral-bg',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'absolute top-0.5 size-3.5 rounded-full bg-background transition-all',
              props.showIgnored ? 'left-[18px]' : 'left-0.5',
            )}
          />
        </button>
        <span>{t('toolbar.showIgnored')}</span>
      </label>
      <Button
        type="button"
        size="sm"
        disabled={props.running}
        aria-busy={props.running}
        onClick={props.onRun}
        className="ml-auto"
      >
        {props.running ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {props.running ? t('toolbar.running') : t('toolbar.run')}
      </Button>
    </div>
  );
}
