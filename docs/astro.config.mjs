// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://lacodda.github.io',
	base: '/scheda',
	integrations: [
		starlight({
			title: 'scheda',
			description:
				'A markdown notepad that turns into a vault when there is a folder around it.',
			logo: {
				src: './src/assets/logo.svg',
				alt: 'scheda',
			},
			favicon: '/favicon.svg',
			customCss: ['./src/styles/brand.css'],
			head: [
				{ tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/scheda/apple-touch-icon.png' } },
				{
					tag: 'meta',
					attrs: {
						property: 'og:image',
						content:
							'https://raw.githubusercontent.com/lacodda/scheda/main/assets/social-preview.png',
					},
				},
				{ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
			],
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/lacodda/scheda' }],
			editLink: {
				baseUrl: 'https://github.com/lacodda/scheda/edit/main/docs/',
			},
			sidebar: [
				{ label: 'Getting Started', slug: 'getting-started' },
				{
					label: 'Concepts',
					items: [{ autogenerate: { directory: 'concepts' } }],
				},
				{
					label: 'Reference',
					items: [{ autogenerate: { directory: 'reference' } }],
				},
			],
		}),
	],
});
