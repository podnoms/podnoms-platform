import { createFileRoute, Outlet, useMatch, useNavigate } from '@tanstack/react-router'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'

export const Route = createFileRoute('/_authed/settings')({
  component: SettingsLayout,
})

// Each tab is its own route, so tabs can be linked to and survive a reload.
const tabs = {
  details: '/settings',
  security: '/settings/security',
} as const

function SettingsLayout() {
  const navigate = useNavigate()
  const onSecurity = useMatch({ from: '/_authed/settings/security', shouldThrow: false })
  const tab = onSecurity ? 'security' : 'details'

  return (
    <div className="flex max-w-2xl flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Tabs value={tab} onValueChange={(value) => navigate({ to: tabs[value as keyof typeof tabs] })}>
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="pt-4">
          <Outlet />
        </TabsContent>
      </Tabs>
    </div>
  )
}
