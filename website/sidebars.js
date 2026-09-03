// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'architecture',
    {
      type: 'category',
      label: 'Tools',
      link: {type: 'doc', id: 'tools/overview'},
      items: [
        'tools/filesystem-git-shell',
        'tools/github',
        'tools/vercel',
        'tools/supabase',
        'tools/slack',
        'tools/gmail',
        'tools/notion',
        'tools/terraform',
        'tools/docker',
        'tools/database',
        'tools/secrets',
        'tools/sentry',
        'tools/workflow-tools',
      ],
    },
  ],
};

export default sidebars;
