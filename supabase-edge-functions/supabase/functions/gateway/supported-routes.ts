export const supportedRoutes = [
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
    pattern: /^\/places\/overpass\/?$/,
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