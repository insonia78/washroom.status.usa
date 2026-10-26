// Defines the public gateway paths and HTTP methods accepted for each route.
export const supportedRoutes = [
  { pattern: /^\/frontend\/moderation\/reviews\/?$/, methods: ["GET", "POST"] },
  { pattern: /^\/frontend\/reviews\/?$/, methods: ["GET", "POST"] },
  { pattern: /^\/frontend\/(geocode|map-boundary)\/?$/, methods: ["GET"] },
  { pattern: /^\/frontend\/auth\/v1\/(otp|verify|token|logout)\/?$/, methods: ["POST"] },
  { pattern: /^\/frontend\/auth\/v1\/user\/?$/, methods: ["GET", "PUT"] },
  {
    pattern: /^\/health\/?$/,
    methods: [
      "GET"
    ]
  },
  {
    pattern: /^\/accounts\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/accounts\/login\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/accounts\/access\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/accounts\/password\/setup\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/accounts\/reset-password\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/accounts\/reset-password\/confirm\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/accounts\/deactivate\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/accounts\/\d+\/?$/,
    methods: [
      "PUT",
      "PATCH",
      "DELETE"
    ]
  },
  {
    pattern: /^\/auth\/logout\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/places\/bathrooms\/?$/,
    methods: [
      "GET",
      "POST"
    ]
  },
  {
    pattern: /^\/admin\/access\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/admin\/login\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/admin\/create-password\/?$/,
    methods: [
      "POST"
    ]
  }
];