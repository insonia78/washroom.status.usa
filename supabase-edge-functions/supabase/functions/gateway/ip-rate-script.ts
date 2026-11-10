// EVAL makes the increment, expiry and quota decision atomic across instances.
export const ipRateScript = `
local count = redis.call('GET', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if not count or ttl <= 0 then
  redis.call('SET', KEYS[1], 1, 'PX', 60000)
  return {1, 99, 60}
end
count = tonumber(count)
if not count or count < 1 then
  return redis.error_reply('Invalid IP rate counter')
end
if count >= 100 then
  return {0, 0, math.ceil(ttl / 1000)}
end
count = redis.call('INCR', KEYS[1])
return {1, 100 - count, math.ceil(ttl / 1000)}
`;
