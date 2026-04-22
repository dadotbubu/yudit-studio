module.exports = {
  content: ['./index.html', './app.js'],
  theme: {
    extend: {
      colors: {
        botanical: {
          bg: '#F9F8F4',
          fg: '#2D3A31',
          sage: '#8C9A84',
          clay: '#DCCFC2',
          stone: '#E6E2DA',
          terracotta: '#C27B66',
          cream: '#F2F0EB',
        }
      },
      fontFamily: {
        serif: ['Playfair Display', 'serif'],
        sans: ['Noto Sans KR', 'sans-serif'],
      },
    }
  },
  plugins: [],
}
