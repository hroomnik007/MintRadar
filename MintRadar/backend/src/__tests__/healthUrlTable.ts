// Shared by healthAssertions.test.ts and verifyHealthExample.test.ts: [raw mint URL, the expected `d` tag value].
export const HEALTH_URL_TABLE: Array<[string, string]> = [
  ['https://mint.example.com', 'https://mint.example.com'],
  ['https://mint.example.com/', 'https://mint.example.com'],
  ['https://MINT.Example.COM', 'https://mint.example.com'],
  ['http://mint.example.com', 'https://mint.example.com'],
  ['https://mint.example.com:443', 'https://mint.example.com'],
  ['http://mint.example.com:443/', 'https://mint.example.com'],
  ['https://mint.example.com:3338', 'https://mint.example.com:3338'],
  ['https://mint.example.com/Bitcoin', 'https://mint.example.com/Bitcoin'],
  ['https://Mint.Example.com/Bitcoin/', 'https://mint.example.com/Bitcoin/'],
  ['https://mint.example.com/?a=b', 'https://mint.example.com/?a=b'],
  ['https://mint.example.com/Bitcoin?a=b', 'https://mint.example.com/Bitcoin?a=b'],
  ['https://mint.example.com/Bitcoin#frag', 'https://mint.example.com/Bitcoin'],
  ['https://mint.example.com/#frag', 'https://mint.example.com'],
  ['https://mint.example.com#frag', 'https://mint.example.com'],
  ['https://mint.example.com/#', 'https://mint.example.com'],
  ['  https://mint.example.com/  ', 'https://mint.example.com'],
]
