const en = {
  description: 'Unlink {wallos} (Wallos) from {actual} (Actual Budget)? Both items become unlinked again. Nothing changes in Wallos or Actual Budget.',
  failed: 'Could not unlink {name}.',
  stale: 'This pair is no longer linked. The sync status is being refreshed.',
};

const nl: typeof en = {
  description: '{wallos} (Wallos) en {actual} (Actual Budget) ontkoppelen? Beide items zijn daarna weer ongekoppeld. In Wallos en Actual Budget verandert niets.',
  failed: '{name} kon niet worden ontkoppeld.',
  stale: 'Dit paar is niet meer gekoppeld. De synchronisatiestatus wordt vernieuwd.',
};

export const unlinkDialogMessages = { en, nl };
