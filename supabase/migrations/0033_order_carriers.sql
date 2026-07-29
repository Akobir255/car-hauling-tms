-- The carrier on every order we dispatched, picked up or delivered.
--
-- msgplane shows the hauler and its phone right in the Dispatched, Issues and
-- Picked-Up lists, but no field in any msgplane-*.json export carries it -- all
-- 20 files were scanned for carrier / hauler / mc_number / dot and there is not
-- one such key. The assignment was simply never swept, so the database had
-- exactly 1 carrier link across 25,875 loads and "which loads does this hauler
-- have" was unanswerable.
--
-- Swept from the three tabs on 2026-07-28 (125 orders: 19 dispatched, 91
-- issues, 15 picked-up) and matched to the carrier directory by phone first,
-- then by normalised company name. 107 matched; the 1 others are listed in
-- the session notes -- their haulers are not in the directory at all, and
-- inventing carrier records to hold a name and a phone would put rows in the
-- directory that no one vetted.
--
-- carrier_id is one of the margin-protected columns (0013), so this is a
-- service-role write; the guard keeps it idempotent and stops it overwriting a
-- link a dispatcher has since made by hand.

update loads l
   set carrier_id = v.carrier_id::uuid
  from (values
  ('31345735-US', '3092579a-012f-4da5-8dcf-1d6319c0b3b0'),
  ('31484416-US', '5e1e5d79-bc98-45a4-9ef3-77e1c52685b1'),
  ('31492758-US', 'eb29b603-ec08-4cb7-a3a2-301cd6be6d56'),
  ('31505450-US', '5cfcff24-e072-44dd-b6f4-cf8698c797ca'),
  ('31516138-US', 'a9d6ed4a-4e6c-4844-b5dd-6f660e0af7e2'),
  ('31523518-US', 'd8e8a905-fffd-475e-8dd0-00f618d78b13'),
  ('31527900US', 'ab17a858-3138-45db-af1c-6af80c392a87'),
  ('31530296-US', 'da4e2c9e-fda7-43eb-b06e-d3136e6d66ec'),
  ('31533791-US', '53d7a26a-b644-4683-a5e2-2ed7b8fa4a9d'),
  ('31539246-US', '0a772243-b6cd-47e1-bb79-c4c4568d9599'),
  ('31550695-US', '0e9c64c9-c211-4146-a2a7-a66ae496b05d'),
  ('31553413-US', 'a0aff9dd-5c57-438d-9952-b62be9e529e3'),
  ('31555946-US', '687bee8f-be76-4c02-9291-701e96bd9230'),
  ('31558553US', 'f5faa87c-733c-4e5b-bc77-10198393846b'),
  ('31562998-US', 'a9c04e5c-39a4-43b6-8e18-e4041d227268'),
  ('31564281-US', '9c5b5a56-597e-4138-abe5-87af5cee06cd'),
  ('31569517-US', '19412f5e-72ed-44aa-b37a-b45c136a2a7f'),
  ('31569984-US', 'a9560527-59ad-4760-8528-789880be1f60'),
  ('31570189US', 'a288ff36-0fef-413c-a6c3-b1da211bc8d6'),
  ('31573537-US', 'a499326b-41ea-4092-8c8e-6a539fc4f217'),
  ('31573899-US', '04613363-49ef-4586-a7fd-1aecab0a18d4'),
  ('31578988US', '5a6043b4-938d-48dd-8bdc-d6d4378d3fd0'),
  ('31579365US', '1aa7920d-d7dc-4229-a7be-0971332d06a9'),
  ('31617295-US', '0a772243-b6cd-47e1-bb79-c4c4568d9599'),
  ('31620856-US', 'dde3276c-27eb-44ea-bfd3-9c72d032be4e'),
  ('31621704-US', '33a02c84-0416-4cbb-a539-3bc6337d5b77'),
  ('31622705-US', '39de908d-ae43-404a-a1ed-3bede02c078a'),
  ('31625467-US', '61575769-3213-4e67-b199-4863803a6cca'),
  ('31626052-US', 'e623f509-ca74-4a3f-a6bf-996b405f5b00'),
  ('31627254-US', '3a098b17-42ce-445a-8b0a-97f6816f371c'),
  ('31628000US', '057fc6b2-4c57-4a0e-8d3b-df1244c59554'),
  ('31628004-US', 'f1c05053-5349-455b-946d-d1ee652cba34'),
  ('31628925-US', 'f5dcc578-ccb4-45b3-a654-1c784f566b50'),
  ('31629214-US', '2d3f6b7a-f664-43a9-8b52-cb867f058d3f'),
  ('31633228US', '795a5edc-9c45-4948-8da7-fb431cfafdc7'),
  ('31635303US', '2d3f6b7a-f664-43a9-8b52-cb867f058d3f'),
  ('31635929-US', 'a518a46a-f0d3-4b19-8215-3bd95cb771b3'),
  ('31638404-US', 'd67b8b30-7ed4-4524-8889-2460757df727'),
  ('31640560US', '5dfd4401-49f1-4b87-9f06-c2511c1bdad9'),
  ('31645752US0', '65efe1c8-d648-49e4-84ca-fdc92b4b222f'),
  ('31648566US0', '7c690e79-b4b6-4acb-a04f-e749f35d0c21'),
  ('31650647-US', '3a098b17-42ce-445a-8b0a-97f6816f371c'),
  ('31654516-US', 'f06c936b-417a-4a92-a4c1-4e303b5656df'),
  ('31659076-US', '7ff2dd1e-2764-4cad-b802-781a19ac9936'),
  ('31661498-US', '806abd45-4cea-4691-a7df-3843e40230b9'),
  ('31662058-US', '0a772243-b6cd-47e1-bb79-c4c4568d9599'),
  ('31662522-US', 'fdadf671-aa83-46c0-9856-17314b778f64'),
  ('31666823-US', '8a8edb25-edba-48fd-bc93-7f6e835cb67e'),
  ('31667442-US0', '0cdf9c7d-a449-444c-bb2f-5f46a867409b'),
  ('31675335-US', '85ddb570-0b10-4d84-9d6e-14b96cee595d'),
  ('31704309-US', '991df6c3-7573-47ff-b5e8-dd4178756819'),
  ('31707634-US0', 'db7cc4c3-ff53-44f9-a0fa-bb22d6221c50'),
  ('31714285-US', '04194e2a-f498-4647-8df7-bc796fab2c89'),
  ('31717892-US', '90c4dd26-3a71-46d1-a4b2-3a83f100d8d3'),
  ('31720072-US', '5fbf3e48-8d60-4b09-b2b0-e425f17e1636'),
  ('31727053-US', 'e4991302-4c30-4386-a906-c451256ab777'),
  ('31738322-US', '5ffdbfd3-1302-4491-b732-7601f74411bd'),
  ('31744482-US', 'a010ce91-1760-4074-98ba-a58dafafe7b9'),
  ('31746427-US', '7a93db0f-3630-4441-811a-4c8b002afd68'),
  ('31750883-US', 'fe26feaf-e026-48e1-b82d-a3fb7cef1d08'),
  ('31755772-US', 'df817134-a869-4a8b-8911-fea41508b268'),
  ('31771894-US', 'ae6470b3-02fc-482c-a2e9-78cc15c0b107'),
  ('31779561-US', '3e9049a3-fb21-48f2-8395-288488ae01f0'),
  ('31783788-US', '4bcf4b21-e3b6-4291-b110-0eb3ea8b6ac9'),
  ('31784029-US', 'b44c823b-90f6-4c38-8143-cbb0cfefc431'),
  ('31784651-US', '24c15ae2-a695-4364-9eea-09a7032c72c0'),
  ('31785388-US', 'a322498c-9aeb-4909-84aa-ec8566365cfe'),
  ('31789094-US', '92f7a73f-13b0-4811-80ab-644589577c0c'),
  ('31792299-US', '998f9027-c584-400e-9da9-0f5302b120c6'),
  ('31800319-US', 'ef2d695e-13ee-4228-b6ab-894fe371dc09'),
  ('31800510-US', 'a090144a-b3ef-4576-9174-be830963d825'),
  ('31810240-US', '59191835-44d8-4ccb-b4b7-ae476cdc406d'),
  ('31819452-US', 'b7f9e28c-e6b7-4341-8576-b6f9df4ad118'),
  ('31824654-US', '1e98d9da-f2dc-4c8d-99da-71b664fab555'),
  ('31828181-US', 'a7f1d655-3935-4b1f-ae00-8733ff705f13'),
  ('31849975-US', 'e9098f97-67ff-4000-a76f-0b8b1fc29879'),
  ('31866365-US', 'd35644c7-6536-48b9-8791-b5d5e619db77'),
  ('31875531-US', '0b053038-4d62-439c-ba65-0593ffb396de'),
  ('31876479-US', '603b5a05-aa53-4c16-b412-4e52f0243dc8'),
  ('31882343-US', 'a961b2e6-6b81-4869-ad21-c61494126aec'),
  ('31884806-US', '79611249-9159-4856-b309-0f1d3c8373dd'),
  ('31889613-US0', '47fb7544-cba0-4e16-95e6-4af9233c2c71'),
  ('31890070-US', 'd4b1c74d-3461-4e01-8885-f5f164c71db3'),
  ('31890391-US', '3943f642-9520-414c-8a08-7f24a09cff89'),
  ('31891412-US', 'edb620af-25e2-4338-85b4-0f93aa2b47e8'),
  ('31895215-US', '3097fee1-9bf6-4fea-a896-6e909cc2ba7f'),
  ('31897703-US', '788f7fdd-66ba-4d5f-94c6-74e8f52e129f'),
  ('31899500-US', 'ff5451dd-f298-4e7b-8f3b-01b77fc526e6'),
  ('31900352-US', 'b8b72d5d-56cd-4aed-9525-77739cb728b1'),
  ('31900825-US', '1e2c03a2-8153-4959-a2ec-1889105d17c4'),
  ('31904571-US', 'e3581f3b-2a86-497f-94e9-f15e345c09de'),
  ('31925266-US0', 'f06c936b-417a-4a92-a4c1-4e303b5656df'),
  ('31941288-US', 'df817134-a869-4a8b-8911-fea41508b268'),
  ('31945459US', '7dc21628-1ce8-4063-b037-58ec93bb66c1'),
  ('31951810-US', '8051082d-714c-4137-a817-7ddd47edc126'),
  ('31972588-US', 'e5f52eb6-53e3-4443-8ce2-4cb32b6fe183'),
  ('31972760-US', '38a98e67-7cd2-4524-904c-d0dec8da5430'),
  ('31989401US', '705f5edf-66a3-4c39-98a8-6116841976bc'),
  ('31990763-US', 'addcd853-1895-4937-94a3-5ae3fb6ddb19'),
  ('31994244-US', '0c746c3d-627a-4ac6-bcdc-22a776948e7f'),
  ('31998004US', '215b096e-f97a-4d29-aef9-f8af9d8ca131'),
  ('32006963-US', '4c73d041-8c1c-4ce5-bfff-6299c7f649de'),
  ('32021187-US', '6b74b172-4f3c-4587-9b96-3e73df003c42'),
  ('32043056-US', 'd643d5a2-9b31-484f-9f5f-5728eedf7206'),
  ('32045039-US', '441d6ab4-e732-4851-99a5-27b6f727aa8e'),
  ('32045496-US', 'cd16e68a-aba3-411d-bc07-646e200261a1'),
  ('32055943US', '70836045-d6ec-4689-8920-21c81b0c4b46'),
  ('52956288-US', 'c41a75b8-31ec-4843-b04a-2f08be9ecd5c')
  ) as v(load_number, carrier_id)
 where l.load_number = v.load_number
   and l.carrier_id is null;
