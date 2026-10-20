import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HealthStatus } from '@/components/HealthStatus';

export function App() {
  return (
    <>
      <h1>Walley</h1>
      <Button>
        <Plus />
        Add item
      </Button>
      <HealthStatus />
    </>
  );
}
