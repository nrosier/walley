import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './dialog';

// The test environment is node (no jsdom or happy-dom, no @testing-library),
// and Radix Portal content only mounts in a browser DOM. So this file cannot
// assert that an open dialog shows its title, or that Escape closes it.
// It checks what SSR can reach: a closed dialog renders nothing, and the
// primitives are exported. Title and Escape behaviour needs a DOM test setup.
describe('Dialog', () => {
  it('renders no content while closed', () => {
    const markup = renderToStaticMarkup(
      <Dialog open={false}>
        <DialogContent>
          <DialogTitle>Hidden title</DialogTitle>
          <DialogDescription>Hidden body</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(markup).not.toContain('Hidden title');
    expect(markup).not.toContain('Hidden body');
  });

  it('exports the Dialog and AlertDialog primitives', () => {
    for (const component of [
      Dialog,
      DialogContent,
      DialogTitle,
      DialogDescription,
      AlertDialog,
      AlertDialogContent,
      AlertDialogTitle,
      AlertDialogDescription,
      AlertDialogAction,
      AlertDialogCancel,
    ]) {
      expect(typeof component).toBe('function');
    }
  });
});
