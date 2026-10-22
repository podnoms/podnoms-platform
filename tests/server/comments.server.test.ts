import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyCommentRecipients } from '~/server/comment-notifications.server'
import { addComment, deleteComment, listComments, setCommentLike } from '~/server/comments.server'
import { users } from '~/server/db/schema'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db } from '../helpers'

vi.mock('~/server/comment-notifications.server', () => ({ notifyCommentRecipients: vi.fn() }))

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(notifyCommentRecipients).mockReset()
})

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

describe('replies', () => {
  it('lists replies under their comment, oldest first, at its time, and a reply to a reply joins the thread', async () => {
    const { podcast } = await show()
    const episode = await createEpisode(podcast.id, ready)
    const ann = await createUser({ name: 'Ann' })
    const bob = await createUser({ name: 'Bob' })
    const [top] = (await addComment(ann.id, episode.id, 'Top', 120))!
    const [withReply] = (await addComment(bob.id, episode.id, 'First reply', 5, top!.id))!
    await addComment(ann.id, episode.id, 'Reply to the reply', 5, withReply!.replies[0]!.id)
    const comments = await listComments(episode.id, null)
    expect(comments).toHaveLength(1)
    expect(comments[0]!.replies).toMatchObject([
      { body: 'First reply', atSeconds: 120, parentId: top!.id, author: { name: 'Bob' } },
      { body: 'Reply to the reply', atSeconds: 120, parentId: top!.id, author: { name: 'Ann' } },
    ])
  })

  it("won't reply to a comment on another episode", async () => {
    const { podcast } = await show()
    const one = await createEpisode(podcast.id, ready)
    const other = await createEpisode(podcast.id, ready)
    const user = await createUser()
    const [top] = (await addComment(user.id, one.id, 'Here', 1))!
    expect(await addComment(user.id, other.id, 'There', 1, top!.id)).toBeNull()
  })

  it('goes with its comment when that is deleted', async () => {
    const { podcast } = await show()
    const episode = await createEpisode(podcast.id, ready)
    const user = await createUser()
    const [top] = (await addComment(user.id, episode.id, 'Top', 1))!
    await addComment(user.id, episode.id, 'Reply', 1, top!.id)
    await deleteComment(user.id, top!.id)
    expect(await listComments(episode.id, null)).toEqual([])
  })
})

describe('mentions', () => {
  it("stores mentions of users who exist by their id, so they follow a new slug, and tells them", async () => {
    const { podcast } = await show()
    const episode = await createEpisode(podcast.id, ready)
    const writer = await createUser()
    const ann = await createUser({ slug: 'ann', name: 'Ann' })
    const [comment] = (await addComment(writer.id, episode.id, 'Hey @Ann and @nobody, mail me at me@ann.ie', 1))!
    expect(comment!.body).toBe(`Hey <@${ann.id}> and @nobody, mail me at me@ann.ie`)
    expect(comment!.mentions).toEqual({ [ann.id]: { slug: 'ann', name: 'Ann' } })
    expect(notifyCommentRecipients).toHaveBeenCalledOnce()

    await db.update(users).set({ slug: 'annie' }).where(eq(users.id, ann.id))
    const [again] = await listComments(episode.id, null)
    expect(again!.mentions).toEqual({ [ann.id]: { slug: 'annie', name: 'Ann' } })
  })
})

describe('likes', () => {
  it('counts likes, says whether the viewer likes each, and likes once per user', async () => {
    const { podcast } = await show()
    const episode = await createEpisode(podcast.id, ready)
    const ann = await createUser()
    const bob = await createUser()
    const [comment] = (await addComment(ann.id, episode.id, 'Like me', 1))!
    expect(await setCommentLike(ann.id, comment!.id, true)).toEqual({ likeCount: 1, liked: true })
    expect(await setCommentLike(ann.id, comment!.id, true)).toEqual({ likeCount: 1, liked: true })
    expect(await setCommentLike(bob.id, comment!.id, true)).toEqual({ likeCount: 2, liked: true })
    expect((await listComments(episode.id, ann.id))[0]).toMatchObject({ likeCount: 2, liked: true })
    expect((await listComments(episode.id, null))[0]).toMatchObject({ likeCount: 2, liked: false })
    expect(await setCommentLike(bob.id, comment!.id, false)).toEqual({ likeCount: 1, liked: false })
  })

  it("can't like a comment on an episode the user can't see", async () => {
    const { owner, podcast } = await show()
    const episode = await createEpisode(podcast.id, { ...ready, private: true })
    const [comment] = (await addComment(owner.id, episode.id, 'Mine', 1))!
    expect(await setCommentLike((await createUser()).id, comment!.id, true)).toBeNull()
  })
})

describe('GIFs', () => {
  const gif = { provider: 'giphy' as const, id: 'g1', title: 'Wave', url: 'https://media.giphy.com/media/g1/giphy.gif', width: 200, height: 150 }

  it('takes a GIF with words, or alone, but not nothing at all', async () => {
    const { podcast } = await show()
    const episode = await createEpisode(podcast.id, ready)
    const user = await createUser()
    await addComment(user.id, episode.id, 'Ha', 5, null, gif)
    await addComment(user.id, episode.id, '', 6, null, gif)
    expect(await addComment(user.id, episode.id, '   ', 7)).toBeNull()
    expect((await listComments(episode.id, null)).map((comment) => [comment.body, comment.gif])).toEqual([
      ['Ha', gif],
      ['', gif],
    ])
  })
})

