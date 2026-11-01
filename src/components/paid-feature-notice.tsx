import { Link, useRouteContext } from '@tanstack/react-router'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { paidFeatures, paidPlanName, type PaidFeature } from '~/lib/subscriptions'

// Whether the signed-in user has paid features. The server decides what's
// allowed (see subscriptions.server.ts); this is only for what to offer.
export function usePaidAccess() {
  return useRouteContext({ from: '__root__' }).session?.user.paidAccess ?? true
}

export function PaidFeatureNotice({ feature }: { feature: PaidFeature }) {
  const { title, description } = paidFeatures[feature]
  return (
    <Alert>
      <AlertTitle>{title} need {paidPlanName}</AlertTitle>
      <AlertDescription>
        <p>
          {description}{' '}
          <Link to="/settings/billing" className="underline underline-offset-4">
            See subscription options
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  )
}
