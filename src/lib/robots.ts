// Responses search engines shouldn't index, though they aren't HTML pages
// that could say so themselves: the API, server functions and the job board.
export function noindexPath(pathname: string) {
  return /^\/(api|_serverFn)\//.test(pathname) || /^\/admin\/queues(\/|$)/.test(pathname)
}
