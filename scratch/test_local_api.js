async function test() {
  try {
    const response = await fetch("http://localhost:5173/api/lender/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-passcode": "acp-deal-room"
      },
      body: JSON.stringify({
        companyName: "Jeph Coba",
        contactName: "Jeph",
        email: "realoneade8@gmail.com",
        phone: "+44 344454334"
      })
    });
    
    console.log("Status:", response.status);
    console.log("Headers:", Object.fromEntries(response.headers.entries()));
    const text = await response.text();
    console.log("Body:", text);
  } catch (err) {
    console.error("Fetch error:", err);
  }
}
test();
