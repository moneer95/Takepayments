async function parseCartItems(req){
    try {
        if (req.method === 'POST') {
          let body = '';
    
          req.on('data', chunk => {
            body += chunk.toString();
          });
    
          req.on('end', () => {
            console.log("Raw body:", body);
    
            // detect content type
            const ct = req.headers['content-type'] || '';
    
            if (ct.includes('application/json')) {
              // handle JSON
              try {
                const data = JSON.parse(body);
                console.log("Parsed JSON:", data);
              } catch (err) {
                console.error("Bad JSON:", err.message);
              }
            } else if (ct.includes('application/x-www-form-urlencoded')) {
              // handle form
              const parsed = qs.parse(body);
              console.log("Parsed form:", parsed);
    
              // if your form had <input name="items" value='[{"id":"..."}]'>
              if (parsed.items) {
                try {
                  const items = JSON.parse(parsed.items);
                  console.log("Decoded items array:", items);
                  return items
                } catch (err) {
                  console.error("items not valid JSON:", parsed.items);
                  return undefined
                }
              }
            }
          });
        }
      }
      catch {
        console.log("not POST")
        return undefined
      }
    
}

module.exports={
    parseCartItems
}