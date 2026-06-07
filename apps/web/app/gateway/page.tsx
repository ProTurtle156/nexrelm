'use client';

import { Gateway } from '@/components/gateway/Gateway';

export default function GatewayPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="label">Gateway</div>
        <h1 className="mt-0.5 text-lg font-medium text-text">Network edge &amp; routing</h1>
      </div>
      <Gateway />
    </div>
  );
}
