// Defines the public gateway paths and HTTP methods accepted for each route.
export const supportedRoutes = [
  { pattern: /^\/frontend\/toilet-submissions\/?$/, methods: ["POST"] },
  { pattern: /^\/frontend\/moderation\/toilets\/?$/, methods: ["GET", "POST"] },
  { pattern: /^\/frontend\/admin\/owner-responses\/?$/, methods: ["GET", "POST"] },
  { pattern: /^\/frontend\/admin\/reviews\/?$/, methods: ["GET", "POST"] },
  { pattern: /^\/frontend\/admin\/toilets\/?$/, methods: ["GET", "POST"] },
  { pattern: /^\/frontend\/admin\/owner-invites\/?$/, methods: ["GET", "POST"] },
  { pattern: /^\/frontend\/admin\/owner-replies\/?$/, methods: ["GET", "POST"] },
  { pattern: /^\/frontend\/moderation\/owner-replies\/?$/, methods: ["GET", "POST"] },
  { pattern: /^\/frontend\/owner\/reviews\/?$/, methods: ["GET"] },
  { pattern: /^\/frontend\/owner\/review-photos\/?$/, methods: ["POST"] },
  { pattern: /^\/frontend\/owner\/replies\/?$/, methods: ["POST"] },
  { pattern: /^\/frontend\/admin\/review-replies\/?$/, methods: ["GET", "POST"] },
  { pattern: /^\/frontend\/owner-responses\/?$/, methods: ["GET"] },
  { pattern: /^\/frontend\/moderation\/reviews\/?$/, methods: ["GET", "POST"] },
  { pattern: /^\/frontend\/reviews\/?$/, methods: ["GET", "POST"] },
  { pattern: /^\/frontend\/(geocode|map-boundary)\/?$/, methods: ["GET"] },
  { pattern: /^\/frontend\/auth\/v1\/(otp|verify|token|logout)\/?$/, methods: ["POST"] },
  { pattern: /^\/frontend\/auth\/v1\/user\/?$/, methods: ["GET", "PUT"] },
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
  }
];