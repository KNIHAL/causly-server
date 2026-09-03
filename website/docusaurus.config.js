// @ts-check
import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Causly Server',
  tagline: 'One conversation. Your whole stack.',
  favicon: 'img/favicon.png',

  future: {
    v4: true,
  },

  url: 'https://knihal.github.io',
  baseUrl: '/causly-server/',

  organizationName: 'KNIHAL',
  projectName: 'causly-server',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          routeBasePath: 'docs',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/docusaurus-social-card.jpg',
      colorMode: {
        defaultMode: 'dark',
        respectPrefersColorScheme: false,
      },
      navbar: {
        title: '',
        logo: {
          alt: 'Causly Server',
          src: 'img/causly-logo.png',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docsSidebar',
            position: 'left',
            label: 'Docs',
          },
          {
            href: 'https://github.com/KNIHAL/causly-server',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {label: 'Architecture', to: '/docs/architecture'},
              {label: 'All tool categories', to: '/docs/tools/overview'},
            ],
          },
          {
            title: 'Project',
            items: [
              {label: 'Roadmap', href: 'https://github.com/KNIHAL/causly-server/blob/main/ROADMAP.md'},
              {label: 'Changelog', href: 'https://github.com/KNIHAL/causly-server/blob/main/CHANGELOG.md'},
              {label: 'Contributing', href: 'https://github.com/KNIHAL/causly-server/blob/main/CONTRIBUTING.md'},
            ],
          },
          {
            title: 'More',
            items: [
              {label: 'GitHub', href: 'https://github.com/KNIHAL/causly-server'},
              {label: 'Contact', href: 'mailto:nihal@causly.in'},
            ],
          },
        ],
        copyright: `causly-server — MIT licensed. Built by Kumar Nihal. © ${new Date().getFullYear()}`,
      },
      prism: {
        theme: prismThemes.oneLight,
        darkTheme: prismThemes.oneDark,
      },
    }),
};

export default config;
