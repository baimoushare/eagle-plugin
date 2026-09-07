const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const scriptPath = path.resolve(__dirname, '..', 'eagle-x-collector.user.js')
const source = fs.readFileSync(scriptPath, 'utf8')

// 防止再次出现 1.1.12 的回归：Likes 静态回退必须先取得当前登录用户 ID。
assert.match(source, /operationName:\s*'Likes'[\s\S]{0,500}variables:\s*\{[\s\S]{0,180}userId,/)
assert.match(source, /const userId = await this\.resolveViewerUserId\(\)/)
assert.match(source, /withClientEventToken:\s*false/)
assert.match(source, /withBirdwatchNotes:\s*false/)

// 当前 Viewer 和 UserByScreenName operation id、变量命名与 X bundle 保持一致。
assert.match(source, /5XShkXk2oO2J7SYmTu6pvw/)
assert.match(source, /Gb-d6r0vxPOADdG62OEBpQ/)
assert.match(source, /screen_name:\s*name/)
assert.match(source, /withGrokTranslatedBio:\s*false/)

// 验证 twid 的常见编码形式均可提取数字 userId。
const parseTwid = value => {
    const decoded = decodeURIComponent(String(value || '').replace(/^['"]|['"]$/g, ''))
    return decoded.match(/(?:^|[;&\s])u=(\d+)/)?.[1] || ''
}
assert.equal(parseTwid('u%3D1234567890'), '1234567890')
assert.equal(parseTwid('"u%3D987654321"'), '987654321')
assert.equal(parseTwid('u=24680'), '24680')
assert.equal(parseTwid(''), '')

// 在隔离上下文中实际加载脚本对象，验证三层 viewerId 回退和 Likes 配置。
const runnableSource = source
    .replace('const TMD = (function () {', 'globalThis.TMD = (function () {')
    .replace(/\r?\nTMD\.init\(\)\s*$/, '\n')
const context = {
    console,
    URL,
    URLSearchParams,
    location: { pathname: '/i/history/likes', search: '' },
    document: { querySelector: () => null },
    navigator: { language: 'zh-CN', languages: ['zh-CN'] },
}
vm.createContext(context)
vm.runInContext(runnableSource, context)
const TMD = context.TMD

;(async () => {
    TMD.timelineViewerUserId = ''
    TMD.getCookie = () => 'u%3D1234567890'
    assert.equal(await TMD.resolveViewerUserId(), '1234567890')

    TMD.timelineViewerUserId = ''
    TMD.getCookie = () => ''
    context.document.querySelector = () => ({ getAttribute: () => '/Laobai_Art' })
    TMD.resolveTimelineUserId = async handle => handle === 'Laobai_Art' ? '24680' : ''
    assert.equal(await TMD.resolveViewerUserId(), '24680')

    TMD.timelineViewerUserId = ''
    TMD.getCookie = () => ''
    context.document.querySelector = () => null
    TMD.getGraphQLOperationId = async operation => operation === 'Viewer' ? '5XShkXk2oO2J7SYmTu6pvw' : ''
    TMD.buildXGraphQLHeaders = () => ({})
    TMD.requestJsonInBackground = async url => {
        const parsed = new URL(url)
        assert.equal(parsed.pathname, '/i/api/graphql/5XShkXk2oO2J7SYmTu6pvw/Viewer')
        assert.deepEqual(JSON.parse(parsed.searchParams.get('variables')), { withCommunitiesMemberships: false })
        assert.equal(JSON.parse(parsed.searchParams.get('fieldToggles')).isDelegate, false)
        assert.equal(JSON.parse(parsed.searchParams.get('features')).subscriptions_upsells_api_enabled, false)
        return { data: { viewer: { user_results: { result: { rest_id: '13579' } } } } }
    }
    assert.equal(await TMD.resolveViewerUserId(), '13579')

    TMD.timelineQueryConfig = null
    TMD.getObservedTimelineRequest = () => null
    TMD.resolveViewerUserId = async () => '112233'
    const likesConfig = await TMD.getTimelineQueryConfig()
    assert.equal(likesConfig.operationName, 'Likes')
    assert.equal(likesConfig.variables.userId, '112233')
    assert.equal(likesConfig.variables.includePromotedContent, false)
    assert.equal(likesConfig.variables.withClientEventToken, false)
    assert.equal(likesConfig.variables.withBirdwatchNotes, false)

    console.log('X GraphQL contract and runtime logic checks passed')
})().catch(error => {
    console.error(error)
    process.exitCode = 1
})
