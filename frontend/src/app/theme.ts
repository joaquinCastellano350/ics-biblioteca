import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

// Paleta y medidas de la referencia visual acordada, compartidas por PrimeNG.
export const bibliotecaTheme = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#f1f5f3', 100: '#dfe9e4', 200: '#bdd0c7', 300: '#91afa3',
      400: '#61877b', 500: '#3c675f', 600: '#284e54', 700: '#193e46',
      800: '#123038', 900: '#102930', 950: '#0c1f24',
      color: '#193e46', contrastColor: '#fff', hoverColor: '#123038', activeColor: '#0c1f24',
    },
    focusRing: { width: '2px', style: 'solid', color: '#8ba56b', offset: '3px' },
    formField: {
      borderRadius: '8px', paddingX: '13px', paddingY: '12px',
      background: '#fff', borderColor: '#cfd9d1', hoverBorderColor: '#8ba56b',
      focusBorderColor: '#8ba56b', color: '#243c42', placeholderColor: '#6a7a73',
    },
    text: { color: '#243c42', mutedColor: '#4d615c', hoverColor: '#193e46' },
    content: { background: '#fff', borderColor: '#dfe4dc', color: '#243c42' },
    mask: { background: 'rgba(12, 31, 36, .72)' },
  },
  components: {
    button: { root: {
      borderRadius: '8px', paddingX: '20px', paddingY: '12px', label: { fontWeight: '650' },
      secondary: {
        background: '#e9eee5', hoverBackground: '#dfe6d9', activeBackground: '#d4decc',
        borderColor: '#dfe4dc', hoverBorderColor: '#cfd9d1', activeBorderColor: '#cfd9d1',
        color: '#193e46', hoverColor: '#123038', activeColor: '#123038',
      },
    } },
    dialog: {
      root: { background: '#f8f7f2', borderColor: '#d4ddd0', color: '#243c42', borderRadius: '16px', shadow: '0 30px 110px #153b4540' },
      header: { padding: '30px 30px 0', gap: '12px' },
      content: { padding: '0 30px 30px' },
    },
  },
});
