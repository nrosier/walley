import { Loader2 } from 'lucide-react';
import { useT } from '@/i18n';
import { syncDashboardMessages } from '@/pages/SyncDashboard.messages';
import { Button } from '../ui/button';

export interface ToolbarProps {
  query: string;
  running: boolean;
  onQueryChange?: (query: string) => void;
  onRun?: () => void;
}

/** One toolbar above both columns: search and Run Sync Check, the only filled indigo button on the page. */
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
        className="min-h-(--control-h) w-56 rounded-md border border-input-border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:w-full"
      />
      <Button
        type="button"
        disabled={props.running}
        aria-busy={props.running}
        onClick={props.onRun}
        className="ml-auto min-h-(--control-h) max-md:w-full"
      >
        {props.running ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {props.running ? t('toolbar.running') : t('toolbar.run')}
      </Button>
    </div>
  );
}
