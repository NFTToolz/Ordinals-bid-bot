#### Retrieve bid format

`curl 'https://nfttools.pro/magiceden/v2/ord/btc/offers/create?tokenId=b37ca7758738d471a22522e2e9de789448991cd854d0020e481037e9df5ff710i595&price=1450000&expirationDate=1710731192000&buyerTokenReceiveAddress= bc1qu456w6gka2aug8lfsdf345dv5m0avua5j&buyerPaymentAddress=bc1qu456w6gka2aug8lfsdf345dv5m0avua5j&buyerPaymentPublicKey=0248ea1242a27411fsdf43r34fsd19c856be96a750c7cbd83435f797aed70e62fc63&feerateTier=halfHourFee'`

#### Submit signed bid order format

curl https://nfttools.pro/magiceden/v2/ord/btc/offers/create
--data-raw {
"signedPSBTBase64": "cHNidP8BANoCAAAAAhD3X9/pNxBIDgLQVNgcmUfdsfdsf435UOId1p3yzVAIAAAD/////FhtuRVGXB1jrmtcUukRqiqm/RK+HGqoQyWSgMtn/odsGAAAAAP////8EIgIAAAAAAAAWABTlaadpFuq7xB/8J0tYTKgdrNZTb+qwFQAAAAAAF6kUewQNYKUyZAK3TwLb5GgyyyUb9b+Hmo0AAAAAAAAfdsf345cbKV4uqODbz8lVT1BBopYd3eBgAAAAAABYAFOVpp2kW6rvEH/wnS1hMqB2s1lNvAAAAAAABASsiAgAAAAAAACJRICfU1UChUm4/gBKnbpRzGtesO73ZdSEDSiEqwhzWvHHCAQMEAQAAAAEXIHGsDUE8LHyBa6Fiq5H2WeO/rA5EdWG727qRoqq2jTdZAAEBH1bELgAAAAAAFgAU5WmnaRbqu8Qf/CdLWEyoHazWU28iAgJI6hJConQRSp1aWNYZyFa+lqdQx8vYNDX3l67XDmL8Y0gwRQIhAL/wHI9TJrl6wpuRDPAcCX9kOI/FtC8aL8JNLZMkNl8dAiBOxu2EPs5Icb64U+dh+Pmw3fWe4v73pvZqltffRnZt2AEAAAAAAA==",
"feerateTier": "halfHourFee",
"tokenId": "b37ca7758738d471a22522e2e9de789448991cd854d0020e481037e9df5ff710i595",
"price": 1450000,
"expirationDate": "1710731192000",
"buyerPaymentAddress": "bc1qu456w6gka2aug8lfsdf345dv5m0avua5j",
"buyerPaymentPublicKey": "0248ea1242a27411fsdf43r34fsd19c856be96a750c7cbd83435f797aed70e62fc63",
"buyerReceiveAddress": "bc1qu456w6gka2aug8lfsdf345dv5m0avua5j"
}"

#### Retrieve cancel format

`curl 'https://nfttools.pro/magiceden/v2/ord/btc/offers/cancel?offerId=0dd0d759-9c7d-4953-ab70-7c9a7825df38'`

#### Submit cancel format

curl 'https://nfttools.pro/magiceden/v2/ord/btc/offers/cancel'
--data-raw '{"offerId":"0dd0d759-9c7d-4953-ab70-7c9a7825df38","signedPSBTBase64":"cHNidP8BANoCAAAAAhDfsdfwe4325UiUeN7p4iIlonHUOId1p3yzVAIAAAD/////FhtuRVGXB1jrmtcUukRqiqm/RK+HGqoQyWSgMtn/odsGAAAAAP////8EIgIAAAAAAAAWABTlaadpFuq7xB/8J0tYTKgdrNZTb+qwFQAAAAAAF6kUewQNYKUyZAK3TwLb5GgyyyUb9b+Hmo0AAAAAAAAXqRTqa4MqBcbKV4uqODbz8lVT1BBopYd3eBgAAAAAABYAFOVpp2kW6rvEH/wnS1hMqB2s1lNvAAAAAAABASsiAgAAAAAAACJRICfU1UChUm4/gBKnbpRzGtesO73ZdSEDSiEqwhzWvHHCAQMEAQAAAAEXIHGsDUE8LHyBa6Fiq5H2WeO/rA5EdWG727qRoqq2jTdZAAEBH1bELgAAAAAAFgAU5WmnaRbqu8Qf/CdLWEyoHazWU2dfdsf34RSp1aWNYZyFa+lqdQx8vYNDX3l67XDmL8Y0gwRQIhAL/wHI9TJrl6wpuRDPAcCX9kOI/FtC8aL8JNLZMkNl8dAiBOxu2EPs5Icb64U+dh+Pmw3fWe4v73pvZqltffRnZt2AEAAAAAAA=="}'

#### Retrieve collection sales, listing & offer activity

`curl 'https://nfttools.pro/magiceden/v2/ord/btc/activities?limit=100&offset=0&collectionSymbol=runestone&kind\[\]=buying_broadcasted&kind\[\]=offer_accepted_broadcasted&kind\[\]=coll_offer_fulfill_broadcasted&kind\[\]=list&kind\[\]=offer_placed&kind\[\]=coll_offer_created&kind\[\]=coll_offer_edited'`

#### Retrieve current token offers

`curl 'https://nfttools.pro/magiceden/v2/ord/btc/offers/?status=valid&limit=40&offset=0&sortBy=priceDesc&token_id=0c846871f21039133b790e77ec5fee9bb6882f2efcd04b8c2b183af0641e2150i0'`

#### Retrieve token activities

`curl 'https://nfttools.pro/magiceden/v2/ord/btc/activities?limit=20&offset=0&kind\[\]=buying_broadcasted&kind\[\]=buying_broadcast_dropped&kind\[\]=mint_broadcasted&kind\[\]=list&kind\[\]=delist&kind\[\]=create&kind\[\]=transfer&kind\[\]=offer_accepted_broadcasted&kind\[\]=coll_offer_fulfill_broadcasted&tokenId=0c846871f21039133b790e77ec5fee9bb6882f2efcd04b8c2b183af0641e2150i0'`

#### Retrieve token information

`curl 'https://nfttools.pro/magiceden/v2/ord/btc/tokens/0c846871f21039133b790e77ec5fee9bb6882f2efcd04b8c2b183af0641e2150i0'`

#### Retrieve collection information

`curl 'https://nfttools.pro/magiceden/v2/ord/btc/stat?collectionSymbol=nodemonkes'`

#### Retrieve tokens by collection

`curl 'https://nfttools.pro/magiceden/v2/ord/btc/tokens?limit=100&offset=0&sortBy=priceAsc&minPrice=0&maxPrice=0&collectionSymbol=nodemonkes&disablePendingTransactions=false'`

#### Filter collections

`https://stats-mainnet.magiceden.io/collection_stats/search/bitcoin?window=1d&limit=10&offset=0&walletAddress=bc1p5rw87me62aftc3lgrqpq430gp3rp5wtj4atxz6pum2rmhjhvsk0sx73cgk&sort=floorPrice&direction=desc&filter=%7B%7D`

<!-- Broadcast tx mempool -->

`curl -X POST -sSLd "0200000001fd5b5fcd1cb066c27cfc9fda5428b9be850b81ac440ea51f1ddba2f987189ac1010000008a4730440220686a40e9d2dbffeab4ca1ff66341d06a17806767f12a1fc4f55740a7af24c6b5022049dd3c9a85ac6c51fecd5f4baff7782a518781bbdd94453c8383755e24ba755c01410436d554adf4a3eb03a317c77aa4020a7bba62999df633bba0ea8f83f48b9e01b0861d3b3c796840f982ee6b14c3c4b7ad04fcfcc3774f81bff9aaf52a15751fedfdffffff02416c00000000000017a914bc791b2afdfe1e1b5650864a9297b20d74c61f4787d71d0000000000001976a9140a59837ccd4df25adc31cdad39be6a8d97557ed688ac00000000" "https://mempool.space/api/tx"`
