import { useEffect, useState } from 'react'
import { useNavigate, useRouteContext, useRouter } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { followPodcast } from '~/functions/library'

// Follows a podcast, so its new episodes come to the listener's home page and
// it's in their sidebar. Signed-out visitors are asked to sign in.
export function FollowButton({ podcastId, following: initial }: { podcastId: string; following: boolean }) {
  const { session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const router = useRouter()
  const [following, setFollowing] = useState(initial)
  const [saving, setSaving] = useState(false)
  useEffect(() => setFollowing(initial), [initial])

  async function toggle() {
    if (!session) {
      await navigate({ to: '.', search: (prev) => ({ ...prev, login: true as const }) })
      return
    }
    const next = !following
    setFollowing(next)
    setSaving(true)
    try {
      await followPodcast({ data: { podcastId, following: next } })
      // The sidebar's list of followed podcasts, and the follower count.
      await router.invalidate()
    } catch {
      setFollowing(!next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Button variant={following ? 'secondary' : 'default'} aria-pressed={following} disabled={saving} onClick={toggle}>
      {following ? <Icons.following /> : <Icons.follow />}
      {following ? 'Following' : 'Follow'}
    </Button>
  )
}
