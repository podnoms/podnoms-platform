import { beforeEach, describe, expect, it } from 'vitest'
import { addComment, deleteComment, listComments } from '~/server/comments.server'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

const ready = { status: 'ready' as const, audioUrl: '/api/episodes/x/audio', durationSeconds: 600 }

async function show(values: Parameters<typeof createPodcast>[1] = {}) {
  const owner = await createUser({ name: 'Ada' })
  const podcast = await createPodcast(owner.id, { slug: 'show', ...values })
  return { owner, podcast }
}

describe('addComment', () => {
  it('lists comments in the order they come in the episode, with who wrote them', async () => {
    const { podcast } = await show()
    const episode = await createEpisode(podcast.id, ready)
    const ann = await createUser({ name: 'Ann' })
    const bob = await createUser({ name: 'Bob' })
    await addComment(ann.id, episode.id, '  Later bit  ', 300)
    await addComment(bob.id, episode.id, 'Great intro', 12.7)
    const comments = await listComments(episode.id, null)
    expect(comments).toMatchObject([
      { body: 'Great intro', atSeconds: 12, author: { name: 'Bob' }, canDelete: false },
      { body: 'Later bit', atSeconds: 300, author: { name: 'Ann' }, canDelete: false },
    ])
    // Writers' ids aren't handed out.
    expect(comments[0]).not.toHaveProperty('userId')
  })

  it('keeps the time within the episode', async () => {
    const { podcast } = await show()
    const episode = await createEpisode(podcast.id, ready)
    const listener = await createUser()
    const comments = await addComment(listener.id, episode.id, 'Past the end', 9999)
    expect(comments).toMatchObject([{ atSeconds: 600 }])
  })

  it("won't comment on what the user can't see", async () => {
    const { owner, podcast } = await show()
    const hidden = await createEpisode(podcast.id, { ...ready, private: true })
    const pending = await createEpisode(podcast.id, { status: 'pending' })
    const listener = await createUser()
    expect(await addComment(listener.id, hidden.id, 'Hi', 0)).toBeNull()
    expect(await addComment(listener.id, pending.id, 'Hi', 0)).toBeNull()
    expect(await addComment(listener.id, 'missing', 'Hi', 0)).toBeNull()
    // Owners can comment on their own private episodes, and only they see it.
    expect(await addComment(owner.id, hidden.id, 'Note to self', 5)).toHaveLength(1)
    expect(await listComments(hidden.id, listener.id)).toEqual([])
    expect(await listComments(hidden.id, null)).toEqual([])
  })
})

describe('deleteComment', () => {
  it('lets the writer and the podcast owner delete a comment, and nobody else', async () => {
    const { owner, podcast } = await show()
    const episode = await createEpisode(podcast.id, ready)
    const writer = await createUser()
    const other = await createUser()
    const [first] = (await addComment(writer.id, episode.id, 'One', 1))!
    const [, second] = (await addComment(writer.id, episode.id, 'Two', 2))!
    expect((await listComments(episode.id, writer.id)).map((c) => c.canDelete)).toEqual([true, true])
    expect((await listComments(episode.id, owner.id)).map((c) => c.canDelete)).toEqual([true, true])
    expect((await listComments(episode.id, other.id)).map((c) => c.canDelete)).toEqual([false, false])

    expect(await deleteComment(other.id, first!.id)).toBe(false)
    expect(await deleteComment(writer.id, first!.id)).toBe(true)
    expect(await deleteComment(owner.id, second!.id)).toBe(true)
    expect(await deleteComment(owner.id, 'missing')).toBe(false)
    expect(await listComments(episode.id, null)).toEqual([])
  })
})
