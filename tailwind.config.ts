import type { Config } from "tailwindcss"
import tailwindcssAnimate from "tailwindcss-animate"
import typography from "@tailwindcss/typography"

const config = {
    darkMode: ["class"],
    content: [
        './pages/**/*.{ts,tsx}',
        './components/**/*.{ts,tsx}',
        './app/**/*.{ts,tsx}',
        './src/**/*.{ts,tsx}',
    ],
    prefix: "",
    theme: {
        container: {
            center: true,
            padding: "2rem",
            screens: {
                "2xl": "1400px",
            },
        },
        extend: {
            colors: {
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                coral: {
                    DEFAULT: "hsl(var(--fdnda-coral))",
                    foreground: "hsl(var(--fdnda-coral-foreground))",
                    soft: "hsl(var(--fdnda-coral-soft))",
                    strong: "hsl(var(--fdnda-coral-strong))",
                },
                fdnda: {
                    primary: "hsl(var(--fdnda-primary))",
                    secondary: "hsl(var(--fdnda-secondary))",
                    accent: "hsl(var(--fdnda-accent))",
                    light: "hsl(var(--fdnda-light))",
                },
                success: {
                    DEFAULT: "hsl(var(--success))",
                    foreground: "hsl(var(--success-foreground))",
                },
                warning: {
                    DEFAULT: "hsl(var(--warning))",
                    foreground: "hsl(var(--warning-foreground))",
                },
            },
            fontFamily: {
                sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
                display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
                "2xl": "calc(var(--radius) + 8px)",
                "3xl": "calc(var(--radius) + 16px)",
            },
            boxShadow: {
                card: "var(--shadow-card)",
                "card-hover": "var(--shadow-card-hover)",
                elevated: "var(--shadow-elevated)",
                "glow-coral": "var(--shadow-glow-coral)",
                "glow-primary": "var(--shadow-glow-primary)",
            },
            transitionTimingFunction: {
                "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
                spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
                "in-out-soft": "cubic-bezier(0.65, 0, 0.35, 1)",
            },
            backgroundImage: {
                "gradient-hero": "var(--gradient-hero)",
                "gradient-card-glow": "var(--gradient-card-glow)",
                "gradient-aqua-coral": "var(--gradient-aqua-coral)",
                "gradient-text-fdnda": "var(--gradient-text-fdnda)",
                "gradient-fade-bottom": "var(--gradient-fade-bottom)",
            },
            keyframes: {
                "accordion-down": {
                    from: { height: "0" },
                    to: { height: "var(--radix-accordion-content-height)" },
                },
                "accordion-up": {
                    from: { height: "var(--radix-accordion-content-height)" },
                    to: { height: "0" },
                },
                "scan": {
                    "0%": { top: "0%", opacity: "1" },
                    "50%": { top: "100%", opacity: "0.8" },
                    "100%": { top: "0%", opacity: "1" },
                },
                "fade-up": {
                    from: { opacity: "0", transform: "translateY(16px)" },
                    to: { opacity: "1", transform: "translateY(0)" },
                },
                "fade-in": {
                    from: { opacity: "0" },
                    to: { opacity: "1" },
                },
                "scale-in": {
                    from: { opacity: "0", transform: "scale(0.95)" },
                    to: { opacity: "1", transform: "scale(1)" },
                },
                "slide-in-right": {
                    from: { opacity: "0", transform: "translateX(20px)" },
                    to: { opacity: "1", transform: "translateX(0)" },
                },
                "shimmer": {
                    "0%": { transform: "translateX(-100%)" },
                    "100%": { transform: "translateX(100%)" },
                },
                "float": {
                    "0%, 100%": { transform: "translateY(0)" },
                    "50%": { transform: "translateY(-12px)" },
                },
                "marquee": {
                    "0%": { transform: "translateX(0)" },
                    "100%": { transform: "translateX(-50%)" },
                },
                "gradient-shift": {
                    "0%, 100%": { backgroundPosition: "0% 50%" },
                    "50%": { backgroundPosition: "100% 50%" },
                },
                "bubble": {
                    "0%": { transform: "translateY(0) scale(0.8)", opacity: "0" },
                    "10%": { opacity: "0.6" },
                    "90%": { opacity: "0.6" },
                    "100%": { transform: "translateY(-120vh) scale(1.1)", opacity: "0" },
                },
            },
            animation: {
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
                "scan": "scan 1.5s ease-in-out infinite",
                "fade-up": "fade-up 0.45s cubic-bezier(0.16, 1, 0.3, 1) both",
                "fade-in": "fade-in 0.4s ease-out both",
                "scale-in": "scale-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both",
                "slide-in-right": "slide-in-right 0.35s cubic-bezier(0.16, 1, 0.3, 1) both",
                "shimmer": "shimmer 1.6s infinite",
                "float": "float 4s ease-in-out infinite",
                "float-slow": "float 7s ease-in-out infinite",
                "float-fast": "float 2.8s ease-in-out infinite",
                "marquee": "marquee 28s linear infinite",
                "gradient-shift": "gradient-shift 6s cubic-bezier(0.65, 0, 0.35, 1) infinite",
                "bubble": "bubble 8s linear infinite",
            },
        },
    },
    plugins: [tailwindcssAnimate, typography],
} satisfies Config

export default config
