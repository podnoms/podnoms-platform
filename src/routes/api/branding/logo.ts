import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '~/server/auth.server'
import { resetLogo, saveLogo } from '~/server/branding.server'
import { maxImageBytes } from '~/server/images.server'
import { UploadError } from '~/server/uploads.server'
import { isAdmin } from '~/server/users.server'

async function adminOnly(request: Request) {
  const session = await getSession(request)
  if (!session?.user?.id) return new Response('You need to be signed in', { status: 401 })
  if (!(await isAdmin(session.user.id))) return new Response('Admins only', { status: 403 })
  return null
}

// The site's logo, from the admin branding page: POST an image (the raw
// request body) to replace it at once, DELETE to go back to the default.
export const Route = createFileRoute('/api/branding/logo')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const refused = await adminOnly(request)
        if (refused) return refused
        if (!request.body) return new Response('No image was sent', { status: 400 })
        if (Number(request.headers.get('content-length')) > maxImageBytes) {
          return new Response('That image is too big to upload', { status: 413 })
        }
        try {
          return Response.json(await saveLogo(request.body))
        } catch (error) {
          if (error instanceof UploadError) return new Response(error.message, { status: error.status })
          throw error
        }
      },
      DELETE: async ({ request }) => {
        const refused = await adminOnly(request)
        if (refused) return refused
        await resetLogo()
        return new Response(null, { status: 204 })
      },
    },
  },
})
