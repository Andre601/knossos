import { promises as fs } from 'fs'
import { pathToFileURL } from 'node:url'
import svgLoader from 'vite-svg-loader'
import { resolve, basename, relative } from 'pathe'
import { defineNuxtConfig } from 'nuxt/config'
import { $fetch } from 'ofetch'
import { globIterate } from 'glob'
import { match as matchLocale } from '@formatjs/intl-localematcher'
import { consola } from 'consola'

const STAGING_API_URL = 'https://staging-api.modrinth.com/v2/'
//const STAGING_API_URL = 'https://api.modrinth.com/v2/'

const preloadedFonts = [
  'inter/Inter-Regular.woff2',
  'inter/Inter-Medium.woff2',
  'inter/Inter-SemiBold.woff2',
  'inter/Inter-Bold.woff2',
]

const favicons = {
  '(prefers-color-scheme:no-preference)': '/favicon-light.ico',
  '(prefers-color-scheme:light)': '/favicon-light.ico',
  '(prefers-color-scheme:dark)': '/favicon.ico',
}

/**
 * Tags of locales that are auto-discovered besides the default locale.
 *
 * Preferably only the locales that reach a certain threshold of complete
 * translations would be included in this array.
 */
const enabledLocales: string[] = []

/**
 * Overrides for the categories of the certain locales.
 */
const localesCategoriesOverrides: Partial<Record<string, 'fun' | 'experimental'>> = {
  'en-x-pirate': 'fun',
  'en-x-updown': 'fun',
  'en-x-lolcat': 'fun',
  'en-x-uwu': 'fun',
  'ru-x-bandit': 'fun',
  ar: 'experimental',
  he: 'experimental',
  pes: 'experimental',
}

export default defineNuxtConfig({
  app: {
    head: {
      htmlAttrs: {
        lang: 'en',
      },
      title: 'nineMinecraft',
      link: [
        // The type is necessary because the linter can't always compare this very nested/complex type on itself
        ...preloadedFonts.map((font): object => {
          return {
            rel: 'preload',
            href: `https://cdn-raw.modrinth.com/fonts/${font}?v=3.19`,
            as: 'font',
            type: 'font/woff2',
            crossorigin: 'anonymous',
          }
        }),
        ...Object.entries(favicons).map(([media, href]): object => {
          return { rel: 'icon', type: 'image/x-icon', href, media }
        }),
        {
          rel: 'search',
          type: 'application/opensearchdescription+xml',
          href: '/opensearch.xml',
          title: 'nineMinecraft mods',
        },
      ],
    },
  },
  vite: {
    plugins: [
      svgLoader({
        svgoConfig: {
          plugins: [
            {
              name: 'preset-default',
              params: {
                overrides: {
                  removeViewBox: false,
                },
              },
            },
          ],
        },
      }),
    ],
  },
  hooks: {
    async 'build:before'() {
      // 30 minutes
      const TTL = 30 * 60 * 1000

      let state: {
        lastGenerated?: string
        apiUrl?: string
        categories?: any[]
        loaders?: any[]
        gameVersions?: any[]
        donationPlatforms?: any[]
        reportTypes?: any[]
      } = {}
      let homePageProjects: any[] = []

      try {
        state = JSON.parse(await fs.readFile('./generated/state.json', 'utf8'))
        homePageProjects = JSON.parse(await fs.readFile('./generated/homepage.json', 'utf8'))
      } catch {
        // File doesn't exist, create folder
        await fs.mkdir('./generated', { recursive: true })
      }

      const API_URL = getApiUrl()

      if (
        // Skip regeneration if within TTL...
        state.lastGenerated &&
        new Date(state.lastGenerated).getTime() + TTL > new Date().getTime() &&
        // ...but only if the API URL is the same
        state.apiUrl === API_URL &&
        homePageProjects.length !== 0
      ) {
        return
      }

      state.lastGenerated = new Date().toISOString()

      state.apiUrl = API_URL

      const headers = {
        headers: {
          'user-agent': 'Knossos generator (support@nineMinecraft.com)',
        },
      }

      const [categories, loaders, gameVersions, donationPlatforms, reportTypes, projects] =
        await Promise.all([
          $fetch(`${API_URL}tag/category`, headers),
          $fetch(`${API_URL}tag/loader`, headers),
          $fetch(`${API_URL}tag/game_version`, headers),
          $fetch(`${API_URL}tag/donation_platform`, headers),
          $fetch(`${API_URL}tag/report_type`, headers),
          $fetch(`${API_URL}projects_random?count=40`, headers),
        ])

      state.categories = categories
      state.loaders = loaders
      state.gameVersions = gameVersions
      state.donationPlatforms = donationPlatforms
      state.reportTypes = reportTypes
      homePageProjects = projects

      await fs.writeFile('./generated/state.json', JSON.stringify(state))
      await fs.writeFile('./generated/homepage.json', JSON.stringify(homePageProjects))

      console.log('Tags generated!')
    },
    'pages:extend'(routes) {
      routes.splice(
        routes.findIndex((x) => x.name === 'search-searchProjectType'),
        1
      )

      const types = ['mods', 'modpacks', 'plugins', 'resourcepacks', 'shaders', 'datapacks']

      types.forEach((type) =>
        routes.push({
          name: `search-${type}`,
          path: `/${type}`,
          file: resolve(__dirname, 'pages/search/[searchProjectType].vue'),
          children: [],
        })
      )
    },
    async 'vintl:extendOptions'(opts) {
      opts.locales ??= []

      console.log(`https://${process.env.VERCEL_URL}`)
      console.log(getDomain())
      if (getDomain() === 'https://dev.nineminecraft.com') {
        console.log(`${getDomain()} and ${'https://dev.nineminecraft.com'} am the same`)
      }
      const isProduction = getDomain() === 'https://dev.nineminecraft.com'

      const resolveCompactNumberDataImport = await (async () => {
        const compactNumberLocales: string[] = []

        for await (const localeFile of globIterate(
          'node_modules/@vintl/compact-number/dist/locale-data/*.mjs',
          { ignore: '**/*.data.mjs' }
        )) {
          const tag = basename(localeFile, '.mjs')
          compactNumberLocales.push(tag)
        }

        function resolveImport(tag: string) {
          const matchedTag = matchLocale([tag], compactNumberLocales, 'en-x-placeholder')
          return matchedTag === 'en-x-placeholder'
            ? undefined
            : `@vintl/compact-number/locale-data/${matchedTag}`
        }

        return resolveImport
      })()

      const resolveOmorphiaLocaleImport = await (async () => {
        const omorphiaLocales: string[] = []
        const omorphiaLocaleSets = new Map<string, { files: { from: string }[] }>()

        for await (const localeDir of globIterate('node_modules/omorphia/locales/*', {
          posix: true,
        })) {
          const tag = basename(localeDir)
          omorphiaLocales.push(tag)

          const localeFiles: { from: string; format?: string }[] = []

          omorphiaLocaleSets.set(tag, { files: localeFiles })

          for await (const localeFile of globIterate(`${localeDir}/*`, { posix: true })) {
            localeFiles.push({
              from: pathToFileURL(localeFile).toString(),
              format: 'default',
            })
          }
        }

        return function resolveLocaleImport(tag: string) {
          return omorphiaLocaleSets.get(matchLocale([tag], omorphiaLocales, 'en-x-placeholder'))
        }
      })()

      for await (const localeDir of globIterate('locales/*/', { posix: true })) {
        const tag = basename(localeDir)
        if (isProduction && !enabledLocales.includes(tag) && opts.defaultLocale !== tag) continue

        const locale =
          opts.locales.find((locale) => locale.tag === tag) ??
          opts.locales[opts.locales.push({ tag }) - 1]

        const localeFiles = (locale.files ??= [])

        for await (const localeFile of globIterate(`${localeDir}/*`, { posix: true })) {
          const fileName = basename(localeFile)
          if (fileName === 'index.json') {
            localeFiles.push({
              from: `./${localeFile}`,
              format: 'crowdin',
            })
          } else if (fileName === 'meta.json') {
            const meta: Record<string, { message: string }> = await fs
              .readFile(localeFile, 'utf8')
              .then((date) => JSON.parse(date))
            locale.meta ??= {}
            for (const key in meta) {
              locale.meta[key] = meta[key].message
            }
          } else {
            ; (locale.resources ??= {})[fileName] = `./${localeFile}`
          }
        }

        const categoryOverride = localesCategoriesOverrides[tag]
        if (categoryOverride != null) {
          ; (locale.meta ??= {}).category = categoryOverride
        }

        const omorphiaLocaleData = resolveOmorphiaLocaleImport(tag)
        if (omorphiaLocaleData != null) {
          localeFiles.push(...omorphiaLocaleData.files)
        }

        const cnDataImport = resolveCompactNumberDataImport(tag)
        if (cnDataImport != null) {
          ; (locale.additionalImports ??= []).push({
            from: cnDataImport,
            resolve: false,
          })
        }
      }
    },
  },
  runtimeConfig: {
    // @ts-ignore
    apiBaseUrl: process.env.BASE_URL ?? globalThis.BASE_URL ?? getApiUrl(),
    // @ts-ignore
    rateLimitKey: process.env.RATE_LIMIT_IGNORE_KEY ?? globalThis.RATE_LIMIT_IGNORE_KEY,
    public: {
      apiBaseUrl: getApiUrl(),
      siteUrl: getDomain(),

      owner: process.env.VERCEL_GIT_REPO_OWNER || 'nineMinecraft',
      slug: process.env.VERCEL_GIT_REPO_SLUG || 'knossos',
      branch:
        process.env.VERCEL_GIT_COMMIT_REF ||
        process.env.CF_PAGES_BRANCH ||
        // @ts-ignore
        globalThis.CF_PAGES_BRANCH ||
        'master',
      hash:
        process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.CF_PAGES_COMMIT_SHA ||
        // @ts-ignore
        globalThis.CF_PAGES_COMMIT_SHA ||
        'unknown',
    },
  },
  typescript: {
    shim: false,
    strict: true,
    typeCheck: true,
    tsConfig: {
      compilerOptions: {
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
      },
    },
  },
  modules: ['@vintl/nuxt', '@nuxtjs/turnstile'],
  vintl: {
    defaultLocale: 'en-US',
    locales: [
      {
        tag: 'en-US',
        meta: {
          static: {
            iso: 'en',
          },
        },
      },
    ],
    storage: 'cookie',
    parserless: 'only-prod',
    seo: {
      defaultLocaleHasParameter: false,
    },
    onParseError({ error, message, messageId, moduleId, parseMessage, parserOptions }) {
      const errorMessage = String(error)
      const modulePath = relative(__dirname, moduleId)

      try {
        const fallback = parseMessage(message, { ...parserOptions, ignoreTag: true })

        consola.warn(
          `[i18n] ${messageId} in ${modulePath} cannot be parsed normally due to ${errorMessage}. The tags will will not be parsed.`
        )

        return fallback
      } catch (err) {
        const secondaryErrorMessage = String(err)

        const reason =
          errorMessage === secondaryErrorMessage
            ? errorMessage
            : `${errorMessage} and ${secondaryErrorMessage}`

        consola.warn(
          `[i18n] ${messageId} in ${modulePath} cannot be parsed due to ${reason}. It will be skipped.`
        )
      }
    },
  },
  turnstile: {
    siteKey: '0x4AAAAAAAHWfmKCm7cUG869',
  },
  nitro: {
    moduleSideEffects: ['@vintl/compact-number/locale-data'],
  },
  devtools: {
    enabled: true,
  },
})

function getApiUrl() {
  // @ts-ignore
  return process.env.BROWSER_BASE_URL ?? globalThis.BROWSER_BASE_URL ?? STAGING_API_URL
}

function getDomain() {
  if (process.env.NODE_ENV === 'production') {
    if (process.env.SITE_URL) {
      return process.env.SITE_URL
    }
    // @ts-ignore
    else if (process.env.CF_PAGES_URL || globalThis.CF_PAGES_URL) {
      // @ts-ignore
      return process.env.CF_PAGES_URL ?? globalThis.CF_PAGES_URL
    } else if (process.env.HEROKU_APP_NAME) {
      return `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`
    } else if (process.env.VERCEL_URL) {
      //return `https://${process.env.VERCEL_URL}`
      return 'https://dev.nineminecraft.com'
      //return 'https://nineminecraft-frontend-hxk8jqbib-worldwidepixels-projects.vercel.app/'
    } else if (getApiUrl() === STAGING_API_URL) {
      return 'https://nineminecraft.com'
    } else if (getApiUrl() === 'https://nineminecraft-frontend-ftu2e5y3l-worldwidepixels-projects.vercel.app') {
      return 'https://dev.nineminecraft.com'
    } else if (getApiUrl() === 'https://dev.nineminecraft.com') {
      return 'https://dev.nineminecraft.com'
    } else {
      return 'https://dev.nineminecraft.com'
    }
  } else {
    return 'http://localhost:3000'
  }
}
