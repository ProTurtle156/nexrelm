'use client';

import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';

export default function OnboardingPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="label">Get started</div>
        <h1 className="mt-0.5 text-lg font-medium text-text">Put Nexrelm on the path</h1>
        <p className="mt-1 text-sm text-muted">A guided, five-step setup: detect your network, grant capabilities, choose how Nexrelm integrates, start capture, and confirm traffic is flowing.</p>
      </div>
      <OnboardingWizard />
    </div>
  );
}
