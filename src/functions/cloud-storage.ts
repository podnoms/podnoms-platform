import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { cloudFileSchema, cloudFolderSchema, cloudProviderNames } from '~/lib/cloud-storage'
import { getSession } from '~/server/auth.server'
import {
  CloudNotConnectedError,
  cloudProviderEnabled,
  importCloudFile,
  listCloudFolder,
} from '~/server/cloud-storage.server'
import { reportError } from '~/server/logger.server'
import { UploadError } from '~/server/uploads.server'

async function requireUserId() {
  const session = await getSession(getRequest())
  if (!session?.user?.id) throw new Error('You need to be signed in')
  return session.user.id
}

// A folder in the user's Dropbox or Box, or `connect` when they need to sign
// in to it first.
export const fetchCloudFolder = createServerFn({ method: 'GET' })
  .validator(cloudFolderSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    if (!cloudProviderEnabled(data.provider)) return { connect: false as const, error: 'That isn\'t available here.' }
    try {
      return { folder: await listCloudFolder(userId, data.provider, data.folderId) }
    } catch (error) {
      if (error instanceof CloudNotConnectedError) return { connect: true as const }
      reportError(error, { msg: 'Could not list a cloud storage folder', provider: data.provider })
      return { connect: false as const, error: `Couldn't open that folder in ${cloudProviderNames[data.provider]}. Please try again.` }
    }
  })

// Copies one of the folder's files into the user's uploads, as if they'd
// uploaded it, to become an episode with the others when the form is sent.
export const importMyCloudFile = createServerFn({ method: 'POST' })
  .validator(cloudFileSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const name = cloudProviderNames[data.provider]
    if (!cloudProviderEnabled(data.provider)) return { error: `${name} isn't available here.` }
    try {
      return { upload: await importCloudFile(userId, data.provider, data.fileId, data.name) }
    } catch (error) {
      if (error instanceof CloudNotConnectedError) return { error: `Your ${name} sign-in has run out. Sign in again and retry.` }
      if (error instanceof UploadError) return { error: error.message }
      reportError(error, { msg: 'Could not copy a file from cloud storage', provider: data.provider })
      return { error: `Couldn't copy that file from ${name}. Please try again.` }
    }
  })
