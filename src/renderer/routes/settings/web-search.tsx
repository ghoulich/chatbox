import { Button, Flex, PasswordInput, Select, Stack, Text, TextInput, Title } from '@mantine/core'
import { IconCheck, IconX } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { ofetch } from 'ofetch'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { TooltipInfoTrigger } from '@/components/common/TooltipInfoTrigger'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { PROVIDERS_WITH_PARSE_LINK } from '@/packages/web-search'
import { BochaSearch } from '@/packages/web-search/bocha'
import { WEB_SEARCH_PROVIDERS, type WebSearchProviderValue } from '@/packages/web-search/constants'
import { QUERIT_SEARCH_URL } from '@/packages/web-search/querit'
import { type SearXNGAuth, SearXNGSearch } from '@/packages/web-search/searxng'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/web-search')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const setSettings = useSettingsStore((state) => state.setSettings)
  const extension = useSettingsStore((state) => state.extension)
  const licenseKey = useSettingsStore((state) => state.licenseKey)

  const [checkingQuerit, setCheckingQuerit] = useState(false)
  const [queritAvailable, setQueritAvailable] = useState<boolean>()
  const checkQuerit = async () => {
    if (extension.webSearch.queritApiKey) {
      setCheckingQuerit(true)
      setQueritAvailable(undefined)
      try {
        await ofetch(QUERIT_SEARCH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${extension.webSearch.queritApiKey}`,
          },
          body: { query: 'Chatbox' },
        })
        setQueritAvailable(true)
      } catch {
        setQueritAvailable(false)
      } finally {
        setCheckingQuerit(false)
      }
    }
  }

  const [checkingSearxng, setCheckingSearxng] = useState(false)
  const [searxngAvailable, setSearxngAvailable] = useState<boolean>()
  const getSearxngAuth = (): SearXNGAuth => {
    if (extension.webSearch.searxngAuthType === 'basic') {
      return {
        type: 'basic',
        username: extension.webSearch.searxngUsername ?? '',
        password: extension.webSearch.searxngPassword ?? '',
      }
    }
    if (extension.webSearch.searxngAuthType === 'bearer') {
      return { type: 'bearer', token: extension.webSearch.searxngBearerToken ?? '' }
    }
    return { type: 'none' }
  }
  const checkSearxng = async () => {
    setCheckingSearxng(true)
    setSearxngAvailable(undefined)
    try {
      const provider = new SearXNGSearch({
        baseUrl: extension.webSearch.searxngBaseUrl ?? '',
        auth: getSearxngAuth(),
        maxResults: extension.webSearch.searxngMaxResults,
        safeSearch: extension.webSearch.searxngSafeSearch,
      })
      await provider.searchImages('Chatbox')
      setSearxngAvailable(true)
    } catch {
      setSearxngAvailable(false)
    } finally {
      setCheckingSearxng(false)
    }
  }

  const [checkingBocha, setCheckingBocha] = useState(false)
  const [bochaAvailable, setBochaAvailable] = useState<boolean>()
  const checkBocha = async () => {
    if (extension.webSearch.bochaApiKey) {
      setCheckingBocha(true)
      setBochaAvailable(undefined)
      try {
        await new BochaSearch(extension.webSearch.bochaApiKey).search('Chatbox')
        setBochaAvailable(true)
      } catch {
        setBochaAvailable(false)
      } finally {
        setCheckingBocha(false)
      }
    }
  }

  const [checkingTavily, setCheckingTavily] = useState(false)
  const [tavilyAvaliable, setTavilyAvaliable] = useState<boolean>()
  const checkTavily = async () => {
    if (extension.webSearch.tavilyApiKey) {
      setCheckingTavily(true)
      setTavilyAvaliable(undefined)
      try {
        await ofetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${extension.webSearch.tavilyApiKey}`,
          },
          body: {
            query: 'Chatbox',
            search_depth: 'basic',
            include_domains: [],
            exclude_domains: [],
          },
        })
        setTavilyAvaliable(true)
      } catch {
        setTavilyAvaliable(false)
      } finally {
        setCheckingTavily(false)
      }
    }
  }

  return (
    <Stack p="md" gap="xxl">
      <Title order={5}>{t('Web Search')}</Title>

      <AdaptiveSelect
        comboboxProps={{ withinPortal: true, withArrow: true }}
        data={WEB_SEARCH_PROVIDERS.map((p) => ({ value: p.value, label: p.label }))}
        value={extension.webSearch.provider}
        onChange={(e) =>
          e &&
          setSettings({
            extension: {
              ...extension,
              webSearch: {
                ...extension.webSearch,
                provider: e as WebSearchProviderValue,
              },
            },
          })
        }
        label={t('Search Provider')}
        maw={320}
      />
      <Stack gap={4}>
        <Text size="xs" c="chatbox-gray">
          {t('Provided tools')}
        </Text>
        {(() => {
          const supportsParseLink = PROVIDERS_WITH_PARSE_LINK.has(extension.webSearch.provider)
          const supportsImageSearch = extension.webSearch.provider === 'searxng'
          const tools: { label: string; supported: boolean }[] = [
            { label: t('Web Search'), supported: true },
            { label: t('Image Search'), supported: supportsImageSearch },
            { label: t('Read Webpage'), supported: supportsParseLink },
          ]
          return tools.map(({ label, supported }) => (
            <Flex key={label} align="center" gap="xs">
              {supported ? (
                <IconCheck size={14} color="var(--mantine-color-chatbox-success-6)" />
              ) : (
                <IconX size={14} color="var(--mantine-color-chatbox-gray-5)" />
              )}
              <Text size="xs" c={supported ? undefined : 'chatbox-gray'}>
                {label}
              </Text>
            </Flex>
          ))
        })()}
      </Stack>
      {extension.webSearch.provider === 'build-in' && (
        <Text size="xs" c="chatbox-gray">
          {t('Chatbox Search is a paid feature with advanced capabilities and better performance.')}
        </Text>
      )}
      {extension.webSearch.provider === 'bing' && (
        <Text size="xs" c="chatbox-gray">
          {t(
            'Bing Search is provided for free use, but it may have limitations and is subject to change by Microsoft.'
          )}
        </Text>
      )}
      {extension.webSearch.provider === 'searxng' && (
        <Stack gap="md">
          <Text size="xs" c="chatbox-gray">
            {t('SearXNG provides private web, image, and video search. The server must enable JSON responses and suitable image and video engines.')}
          </Text>
          <Text size="xs" c="chatbox-gray">
            {t('Webpage reading downloads and extracts the main article text locally on this device.')}
          </Text>
          <Stack gap="xs">
            <TextInput
              label={t('SearXNG Server Address')}
              description={t('Example: https://search.example.com')}
              placeholder="https://search.example.com"
              maw={480}
              value={extension.webSearch.searxngBaseUrl ?? ''}
              error={searxngAvailable === false ? t('Unable to connect to SearXNG.') : undefined}
              onChange={(event) => {
                setSearxngAvailable(undefined)
                setSettings({ extension: { ...extension, webSearch: { ...extension.webSearch, searxngBaseUrl: event.currentTarget.value } } })
              }}
            />
            <AdaptiveSelect
              label={t('Authentication')}
              maw={320}
              data={[{ value: 'none', label: t('None') }, { value: 'basic', label: t('Basic Authentication') }, { value: 'bearer', label: t('Bearer Token') }]}
              value={extension.webSearch.searxngAuthType ?? 'none'}
              onChange={(value) => value && setSettings({ extension: { ...extension, webSearch: { ...extension.webSearch, searxngAuthType: value as 'none' | 'basic' | 'bearer' } } })}
            />
            {extension.webSearch.searxngAuthType === 'basic' && (
              <Flex gap="xs" align="flex-end" wrap="wrap">
                <TextInput label={t('Username')} value={extension.webSearch.searxngUsername ?? ''} onChange={(event) => setSettings({ extension: { ...extension, webSearch: { ...extension.webSearch, searxngUsername: event.currentTarget.value } } })} />
                <PasswordInput label={t('Password')} value={extension.webSearch.searxngPassword ?? ''} onChange={(event) => setSettings({ extension: { ...extension, webSearch: { ...extension.webSearch, searxngPassword: event.currentTarget.value } } })} />
              </Flex>
            )}
            {extension.webSearch.searxngAuthType === 'bearer' && (
              <PasswordInput label={t('Bearer Token')} maw={480} value={extension.webSearch.searxngBearerToken ?? ''} onChange={(event) => setSettings({ extension: { ...extension, webSearch: { ...extension.webSearch, searxngBearerToken: event.currentTarget.value } } })} />
            )}
          </Stack>
          <Flex gap="md" wrap="wrap">
            <Select label={t('Maximum Results')} data={['5', '10', '15', '20']} value={String(extension.webSearch.searxngMaxResults ?? 10)} onChange={(value) => value && setSettings({ extension: { ...extension, webSearch: { ...extension.webSearch, searxngMaxResults: Number(value) } } })} />
            <Select label={t('Safe Search')} data={[{ value: '0', label: t('Off') }, { value: '1', label: t('Moderate') }, { value: '2', label: t('Strict') }]} value={String(extension.webSearch.searxngSafeSearch ?? 1)} onChange={(value) => value && setSettings({ extension: { ...extension, webSearch: { ...extension.webSearch, searxngSafeSearch: Number(value) as 0 | 1 | 2 } } })} />
          </Flex>
          <Flex align="center" gap="xs">
            <Button
              color="blue"
              variant="light"
              onClick={checkSearxng}
              loading={checkingSearxng}
              disabled={!extension.webSearch.searxngBaseUrl?.trim()}
            >
              {t('Check')}
            </Button>
            {searxngAvailable === true && (
              <Text size="xs" c="chatbox-success">
                {t('Connection successful!')}
              </Text>
            )}
          </Flex>
        </Stack>
      )}
      {/* Tavily API Key */}
      {extension.webSearch.provider === 'tavily' && (
        <Stack gap="xs">
          <Text fw="600">{t('Tavily API Key')}</Text>
          <Flex align="center" gap="xs">
            <PasswordInput
              flex={1}
              maw={320}
              value={extension.webSearch.tavilyApiKey}
              onChange={(e) => {
                setTavilyAvaliable(undefined)
                setSettings({
                  extension: {
                    ...extension,
                    webSearch: {
                      ...extension.webSearch,
                      tavilyApiKey: e.currentTarget.value,
                    },
                  },
                })
              }}
              error={tavilyAvaliable === false}
            />
            <Button
              color="blue"
              variant="light"
              onClick={checkTavily}
              loading={checkingTavily}
              disabled={!extension.webSearch.tavilyApiKey?.trim()}
            >
              {t('Check')}
            </Button>
          </Flex>

          {typeof tavilyAvaliable === 'boolean' ? (
            tavilyAvaliable ? (
              <Text size="xs" c="chatbox-success">
                {t('Connection successful!')}
              </Text>
            ) : (
              <Text size="xs" c="chatbox-error">
                {t('API key invalid!')}
              </Text>
            )
          ) : null}
          <Button
            variant="transparent"
            size="compact-xs"
            px={0}
            className="self-start"
            onClick={() => platform.openLink('https://app.tavily.com?utm_source=chatbox')}
          >
            {t('Get API Key')}
          </Button>
        </Stack>
      )}
      {/* BoCha API Key */}
      {extension.webSearch.provider === 'bocha' && (
        <Stack gap="xs">
          <Text fw="600">{t('BoCha API Key')}</Text>
          <Flex align="center" gap="xs">
            <PasswordInput
              flex={1}
              maw={320}
              value={extension.webSearch.bochaApiKey}
              onChange={(e) => {
                setBochaAvailable(undefined)
                setSettings({
                  extension: {
                    ...extension,
                    webSearch: {
                      ...extension.webSearch,
                      bochaApiKey: e.currentTarget.value,
                    },
                  },
                })
              }}
              error={bochaAvailable === false}
            />
            <Button
              color="blue"
              variant="light"
              onClick={checkBocha}
              loading={checkingBocha}
              disabled={!extension.webSearch.bochaApiKey?.trim()}
            >
              {t('Check')}
            </Button>
          </Flex>

          {typeof bochaAvailable === 'boolean' ? (
            bochaAvailable ? (
              <Text size="xs" c="chatbox-success">
                {t('Connection successful!')}
              </Text>
            ) : (
              <Text size="xs" c="chatbox-error">
                {t('API key invalid!')}
              </Text>
            )
          ) : null}
          <Button
            variant="transparent"
            size="compact-xs"
            px={0}
            className="self-start"
            onClick={() => platform.openLink('https://open.bochaai.com')}
          >
            {t('Get API Key')}
          </Button>
        </Stack>
      )}
      {/* Querit API Key */}
      {extension.webSearch.provider === 'querit' && (
        <Stack gap="xs">
          <Text fw="600">{t('Querit API Key')}</Text>
          <Flex align="center" gap="xs">
            <PasswordInput
              flex={1}
              maw={320}
              value={extension.webSearch.queritApiKey}
              onChange={(e) => {
                setQueritAvailable(undefined)
                setSettings({
                  extension: {
                    ...extension,
                    webSearch: {
                      ...extension.webSearch,
                      queritApiKey: e.currentTarget.value,
                    },
                  },
                })
              }}
              placeholder={t('Enter your Querit API Key') || 'Enter your Querit API Key'}
              error={queritAvailable === false}
            />
            <Button
              color="blue"
              variant="light"
              onClick={checkQuerit}
              loading={checkingQuerit}
              disabled={!extension.webSearch.queritApiKey?.trim()}
            >
              {t('Check')}
            </Button>
          </Flex>

          {typeof queritAvailable === 'boolean' ? (
            queritAvailable ? (
              <Text size="xs" c="chatbox-success">
                {t('Connection successful!')}
              </Text>
            ) : (
              <Text size="xs" c="chatbox-error">
                {t('API key invalid!')}
              </Text>
            )
          ) : null}

          <Button
            variant="transparent"
            size="compact-xs"
            px={0}
            className="self-start"
            onClick={() => platform.openLink('https://www.querit.ai')}
          >
            {t('Get API Key')}
          </Button>

          {/* Querit Configuration Options */}
          <Stack mt="md" gap="sm">
            <Title order={6}>{t('Querit Search Options')}</Title>

            {/* Max Results */}
            <Stack gap="xs">
              <Flex align="center" gap="xs">
                <Text size="sm">{t('Max Results')}</Text>
                <Tooltip
                  label={t('Maximum number of results to return.')}
                  withArrow
                  maw={320}
                  className="!whitespace-normal"
                  zIndex={3000}
                  openOnTouch
                >
                  <TooltipInfoTrigger label={t('Max Results')} />
                </Tooltip>
              </Flex>
              <Select
                comboboxProps={{ withinPortal: true, withArrow: true }}
                data={[
                  { value: '1', label: '1' },
                  { value: '2', label: '2' },
                  { value: '3', label: '3' },
                  { value: '4', label: '4' },
                  { value: '5', label: '5' },
                  { value: '6', label: '6' },
                  { value: '7', label: '7' },
                  { value: '8', label: '8' },
                  { value: '9', label: '9' },
                  { value: '10', label: '10' },
                ]}
                value={String(extension.webSearch.queritMaxResults || 5)}
                onChange={(e) =>
                  e &&
                  setSettings({
                    extension: {
                      ...extension,
                      webSearch: {
                        ...extension.webSearch,
                        queritMaxResults: parseInt(e),
                      },
                    },
                  })
                }
                maw={320}
              />
            </Stack>

            {/* Time Range */}
            <Stack gap="xs">
              <Flex align="center" gap="xs">
                <Text size="sm">{t('Time Range')}</Text>
                <Tooltip
                  label={t('Time range of the search. For example, the last month.')}
                  withArrow
                  maw={320}
                  className="!whitespace-normal"
                  zIndex={3000}
                  openOnTouch
                >
                  <TooltipInfoTrigger label={t('Time Range')} />
                </Tooltip>
              </Flex>
              <Select
                comboboxProps={{ withinPortal: true, withArrow: true }}
                data={[
                  { value: 'none', label: 'None' },
                  { value: 'd1', label: 'Day' },
                  { value: 'w1', label: 'Week' },
                  { value: 'm1', label: 'Month' },
                  { value: 'y1', label: 'Year' },
                ]}
                value={extension.webSearch.queritTimeRange || 'none'}
                onChange={(e) =>
                  e &&
                  setSettings({
                    extension: {
                      ...extension,
                      webSearch: {
                        ...extension.webSearch,
                        queritTimeRange: e,
                      },
                    },
                  })
                }
                maw={320}
              />
            </Stack>
          </Stack>
        </Stack>
      )}
      {extension.webSearch.provider !== 'build-in' && !licenseKey && (
        <Tooltip
          label={t(
            'Note: If you have never had a license before, you can claim it after logging in on the official website. Quota refreshed daily.'
          )}
          withArrow
          multiline
          maw={280}
          position="bottom-start"
          styles={{
            tooltip: {
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              backdropFilter: 'blur(4px)',
            },
          }}
        >
          <Text
            size="xs"
            className="cursor-pointer"
            onClick={() => {
              trackJkClickEvent(JK_EVENTS.FREE_LICENSE_CLAIM_CLICK, {
                pageName: JK_PAGE_NAMES.SETTING_PAGE,
                content: 'settings_websearch',
              })
              platform.openLink('https://chatboxai.app/login')
            }}
          >
            {t('You can ')}
            <span className="text-blue-500 underline decoration-dotted">{t('try Chatbox AI')}</span>
            {t(' for free now!')}
          </Text>
        </Tooltip>
      )}
    </Stack>
  )
}
