import preline from "preline/plugin";
import twForms from "@tailwindcss/forms";

/** @type {import("tailwindcss").Config} */
export default {
  darkMode: ["class"],
  content: [
    "./entrypoints/**/*.{js,jsx,ts,tsx}",
    "components/**/*.{ts,tsx}",
    "./node_modules/preline/preline.js",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Figtree", "sans-serif"],
      },
      colors: {
        "icy-blue": {
          50: "#ebffef",
          100: "#cefbf",
          200: "#a2f5f",
          300: "#63eafd",
          400: "#00b1d0",
          500: "#0a7694",
          600: "#125f78",
          700: "#0c465f",
          800: "#093446",
          900: "#072735",
          950: "#051d27",
        },
        daintree: {
          50: "#f6fbef",
          100: "#e2eef7",
          200: "#c1d5de",
          300: "#9eb7ca",
          400: "#7b9aaa",
          500: "#3b6273",
          600: "#2d4f5d",
          700: "#203c49",
          800: "#102832",
          900: "#09171d",
          950: "#071116",
        },
      },
    },
  },
  plugins: [preline, twForms],
};
