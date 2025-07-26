# README

# Contents
- Introduction
- Prerequisites
- Using the Gateway SDK
- License

# Introduction
This NodeJS SDK provides an easy method to integrate with the payment gateway.
 - The gateway.js file contains the main body of the SDK.
 - The sample.js file is intended as a minimal guide to demonstrate a complete 3DSv2 authentication process.

# Prerequisites
- The SDK requires the following prerequisites to be met in order to function correctly:
    - Node v12.x+
    - _htmlentities_ module (`npm install html-entities`)
    - _axios_ module (`npm install axios`)
    - _http-build-query (`npm install http-build-query`)
    - (for testing): _chai_ (`npm install chai`)
    - (for testing): _mocha_ (`npm install mocha`)

> <span style="color: red">Please note that we can only offer support for the SDK itself. While every effort has been made to ensure the sample code is complete and bug free, it is only a guide and should not be used in a production environment.</span>

# Using the Gateway SDK

Require the gateway SDK into your project

```
const gateway = require('./gateway.js').Gateway;
```

Once your SDK has been required. You create your request array, for example:
```
reqFields = {
      "merchantID" => "100856",
      "action" => "SALE",
      "type" => 1,
      "transactionUnique" => uniqid,
      "countryCode" => 826,
      "currencyCode" => 826,
      "amount" => 1001,
      "cardNumber" => "XXXXXXXXXXXXXXXX",
      "cardExpiryMonth" => XX,
      "cardExpiryYear" => XX,
      "cardCVV" => "XXX",
      "customerName" => "Test Customer",
      "customerEmail" => "test@testcustomer.com",
      "customerAddress" => "30 Test Street",
      "customerPostcode" => "TE15 5ST",
      "orderRef" => "Test purchase",

      # The following fields are mandatory for 3DS v2
      "remoteAddress" => remoteAddress,
      "merchantCategoryCode" => 5411,
      "threeDSVersion" => "2",
      "threeDSRedirectURL" => pageUrl + "&acs=1",
    }

```
> NB: This is a sample request. The gateway features many more options. Please see our integration guides for more details.

Then, depending on your integration method, you'd either call (as a promise):

```
gateway.directRequest(reqFields)
```

OR

```
gateway.hostedRequest(reqFields)
```

And then handle the response received from the gateway.

License
----
MIT
