/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#4A148C",
        secondary: "#E1BEE7",
      }
    },
  },
  plugins: [],
  presets: [require("nativewind/preset")],
}
