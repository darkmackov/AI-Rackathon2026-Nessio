// Generated from data/demo/directory.json by npm run sync:demo.
import type { Actor, MdtBoard, Organization } from '../client/types.gen'

export const organizations: Organization[] = [
  {
    "id": "koc1-severni",
    "name": "KOC Nemocnice Severní",
    "kind": "koc",
    "address": "Severní 1200, 180 00 Praha 8",
    "phone": "+420 220 000 100",
    "email": "koordinace@nemocnice-severni.example"
  },
  {
    "id": "koc2-lipova",
    "name": "KOC Nemocnice Lipová",
    "kind": "koc",
    "address": "Nemocniční 15, 140 00 Praha 4",
    "phone": "+420 240 000 200",
    "email": "koordinace@nemocnice-lipova.example"
  },
  {
    "id": "koc3-vychodni",
    "name": "KOC Fakultní nemocnice Východní",
    "kind": "koc",
    "address": "Východní 40, 625 00 Brno",
    "phone": "+420 530 000 300",
    "email": "koordinace@fn-vychodni.example"
  },
  {
    "id": "koc4-horska",
    "name": "KOC Krajská nemocnice Horská",
    "kind": "koc",
    "address": "Horská 8, 708 00 Ostrava",
    "phone": "+420 590 000 400",
    "email": "koordinace@kn-horska.example"
  },
  {
    "id": "koc5-zapadni",
    "name": "KOC Nemocnice Západní",
    "kind": "koc",
    "address": "Západní 77, 301 00 Plzeň",
    "phone": "+420 370 000 500",
    "email": "koordinace@nemocnice-zapadni.example"
  },
  {
    "id": "pl-breztany",
    "name": "Ordinace praktického lékaře pro dospělé, MUDr. Tomáš Řezníček",
    "kind": "gp_practice",
    "address": "Na Návsi 3, 252 41 Dolní Břežany",
    "phone": "+420 311 000 287",
    "identifiers": {
      "icp": "72045318"
    }
  },
  {
    "id": "pl-ricany",
    "name": "Praktický lékař Říčany, MUDr. Jana Nováková",
    "kind": "gp_practice",
    "address": "Masarykovo nám. 12, 251 01 Říčany",
    "phone": "+420 323 000 111"
  },
  {
    "id": "pl-brno-lisen",
    "name": "Ordinace PL Brno-Líšeň, MUDr. Petr Beneš",
    "kind": "gp_practice",
    "address": "Holzova 5, 628 00 Brno",
    "phone": "+420 544 000 222"
  },
  {
    "id": "pl-ostrava-poruba",
    "name": "Praktický lékař Poruba, MUDr. Klára Marešová",
    "kind": "gp_practice",
    "address": "Hlavní třída 101, 708 00 Ostrava",
    "phone": "+420 596 000 333"
  },
  {
    "id": "poliklinika-jizni",
    "name": "Poliklinika Jižní",
    "kind": "clinic",
    "address": "Za Poliklinikou 5, 143 00 Praha 4"
  },
  {
    "id": "kardio-jesenice",
    "name": "Kardiologická ambulance Jesenice",
    "kind": "clinic",
    "address": "Budějovická 410, 252 42 Jesenice"
  },
  {
    "id": "labjih",
    "name": "Laboratoř LabJih s.r.o.",
    "kind": "laboratory",
    "address": "Libušská 300, 142 00 Praha 4"
  },
  {
    "id": "rdg-modrany",
    "name": "Radiologické centrum Modřany",
    "kind": "radiology",
    "address": "Komořanská 120, 143 00 Praha 4"
  },
  {
    "id": "zp-111",
    "name": "Všeobecná zdravotní pojišťovna ČR",
    "kind": "insurer",
    "identifiers": {
      "kp": "111"
    }
  },
  {
    "id": "zp-201",
    "name": "Vojenská zdravotní pojišťovna ČR",
    "kind": "insurer",
    "identifiers": {
      "kp": "201"
    }
  },
  {
    "id": "zp-205",
    "name": "Česká průmyslová zdravotní pojišťovna",
    "kind": "insurer",
    "identifiers": {
      "kp": "205"
    }
  },
  {
    "id": "zp-207",
    "name": "Oborová zdravotní pojišťovna",
    "kind": "insurer",
    "identifiers": {
      "kp": "207"
    }
  },
  {
    "id": "zp-209",
    "name": "Zaměstnanecká pojišťovna Škoda",
    "kind": "insurer",
    "identifiers": {
      "kp": "209"
    }
  },
  {
    "id": "zp-211",
    "name": "Zdravotní pojišťovna ministerstva vnitra ČR",
    "kind": "insurer",
    "identifiers": {
      "kp": "211"
    }
  },
  {
    "id": "zp-213",
    "name": "RBP, zdravotní pojišťovna",
    "kind": "insurer",
    "identifiers": {
      "kp": "213"
    }
  }
]

export const actors: Actor[] = [
  {
    "id": "pl-reznicek",
    "name": "MUDr. Tomáš Řezníček",
    "role": "referring_doctor",
    "organization_id": "pl-breztany",
    "phone": "+420 311 000 287",
    "email": null
  },
  {
    "id": "pl-novakova",
    "name": "MUDr. Jana Nováková",
    "role": "referring_doctor",
    "organization_id": "pl-ricany",
    "phone": "+420 323 000 111",
    "email": "novakova@ordinace-ricany.example"
  },
  {
    "id": "pl-benes",
    "name": "MUDr. Petr Beneš",
    "role": "referring_doctor",
    "organization_id": "pl-brno-lisen",
    "phone": "+420 544 000 222",
    "email": "benes@pl-lisen.example"
  },
  {
    "id": "pl-maresova",
    "name": "MUDr. Klára Marešová",
    "role": "referring_doctor",
    "organization_id": "pl-ostrava-poruba",
    "phone": "+420 596 000 333",
    "email": "maresova@pl-poruba.example"
  },
  {
    "id": "gastro-krizova",
    "name": "MUDr. Ivana Křížová",
    "role": "referring_doctor",
    "organization_id": "poliklinika-jizni",
    "email": "krizova@poliklinika-jizni.example"
  },
  {
    "id": "koordinator",
    "name": "Bc. Lucie Dvořáková",
    "role": "coordinator",
    "organization_id": "koc2-lipova",
    "phone": "+420 240 000 210",
    "email": "dvorakova@nemocnice-lipova.example"
  },
  {
    "id": "koord-severni",
    "name": "Mgr. Jitka Králová",
    "role": "coordinator",
    "organization_id": "koc1-severni",
    "phone": "+420 220 000 110",
    "email": "kralova@nemocnice-severni.example"
  },
  {
    "id": "koord-vychodni",
    "name": "Bc. Martin Pospíšil",
    "role": "coordinator",
    "organization_id": "koc3-vychodni",
    "phone": "+420 530 000 310",
    "email": "pospisil@fn-vychodni.example"
  },
  {
    "id": "koord-horska",
    "name": "Bc. Tereza Urbanová",
    "role": "coordinator",
    "organization_id": "koc4-horska",
    "phone": "+420 590 000 410",
    "email": "urbanova@kn-horska.example"
  },
  {
    "id": "koord-zapadni",
    "name": "Bc. Ondřej Malík",
    "role": "coordinator",
    "organization_id": "koc5-zapadni",
    "phone": "+420 370 000 510",
    "email": "malik@nemocnice-zapadni.example"
  },
  {
    "id": "kardio-maly",
    "name": "MUDr. Petr Malý",
    "role": "specialist",
    "organization_id": "kardio-jesenice"
  },
  {
    "id": "rdg-kopecky",
    "name": "MUDr. Jan Kopecký",
    "role": "specialist",
    "organization_id": "poliklinika-jizni"
  },
  {
    "id": "rdg-fiala",
    "name": "MUDr. Daniel Fiala, Ph.D.",
    "role": "specialist",
    "organization_id": "koc1-severni"
  },
  {
    "id": "endo-svoboda",
    "name": "MUDr. Martin Svoboda",
    "role": "specialist",
    "organization_id": "koc2-lipova"
  },
  {
    "id": "onko-markova",
    "name": "MUDr. Lenka Marková",
    "role": "specialist",
    "organization_id": "koc2-lipova"
  },
  {
    "id": "pato-pokorny",
    "name": "MUDr. Radek Pokorný, Ph.D.",
    "role": "specialist",
    "organization_id": "koc2-lipova"
  },
  {
    "id": "algeziolog-holub",
    "name": "MUDr. Zdeněk Holub",
    "role": "specialist",
    "organization_id": "koc1-severni"
  },
  {
    "id": "psycholog-vesela",
    "name": "Mgr. Kateřina Veselá",
    "role": "specialist",
    "organization_id": "koc2-lipova"
  }
]

export const boards: MdtBoard[] = [
  {
    "id": "mdt-git-lipova",
    "name": "MDT pro nádory GIT",
    "organization_id": "koc2-lipova",
    "members": [
      {
        "name": "doc. MUDr. Pavel Hrubý, Ph.D.",
        "specialty": "chirurg, HPB chirurgie"
      },
      {
        "name": "MUDr. Lenka Marková",
        "specialty": "klinická onkologie",
        "actor_id": "onko-markova"
      },
      {
        "name": "MUDr. Ondřej Kalous",
        "specialty": "radiační onkologie"
      },
      {
        "name": "MUDr. Martin Svoboda",
        "specialty": "gastroenterologie",
        "actor_id": "endo-svoboda"
      },
      {
        "name": "MUDr. Eva Šimková",
        "specialty": "radiologie"
      },
      {
        "name": "MUDr. Radek Pokorný, Ph.D.",
        "specialty": "patologie",
        "actor_id": "pato-pokorny"
      },
      {
        "name": "Bc. Lucie Dvořáková",
        "specialty": "koordinátorka KOC",
        "actor_id": "koordinator"
      }
    ]
  },
  {
    "id": "mdt-hpb-severni",
    "name": "MDT pro nádory HPB",
    "organization_id": "koc1-severni",
    "members": [
      {
        "name": "prof. MUDr. Aleš Doležal, CSc.",
        "specialty": "chirurg, HPB chirurgie"
      },
      {
        "name": "MUDr. Hana Vlčková",
        "specialty": "klinická onkologie"
      },
      {
        "name": "MUDr. Daniel Fiala, Ph.D.",
        "specialty": "radiologie",
        "actor_id": "rdg-fiala"
      },
      {
        "name": "MUDr. Roman Kříž",
        "specialty": "gastroenterologie"
      },
      {
        "name": "Mgr. Jitka Králová",
        "specialty": "koordinátorka KOC",
        "actor_id": "koord-severni"
      }
    ]
  },
  {
    "id": "mdt-plice-vychodni",
    "name": "MDT pro nádory plic",
    "organization_id": "koc3-vychodni",
    "members": [
      {
        "name": "doc. MUDr. Jiří Sedláček, Ph.D.",
        "specialty": "pneumoonkologie"
      },
      {
        "name": "MUDr. Alena Krejčí",
        "specialty": "hrudní chirurgie"
      },
      {
        "name": "MUDr. Tomáš Bureš",
        "specialty": "radiační onkologie"
      },
      {
        "name": "MUDr. Pavla Říhová",
        "specialty": "radiologie"
      },
      {
        "name": "Bc. Martin Pospíšil",
        "specialty": "koordinátor KOC",
        "actor_id": "koord-vychodni"
      }
    ]
  },
  {
    "id": "mdt-mamma-horska",
    "name": "MDT pro nádory prsu",
    "organization_id": "koc4-horska",
    "members": [
      {
        "name": "MUDr. Ivana Matoušková",
        "specialty": "klinická onkologie"
      },
      {
        "name": "MUDr. Lukáš Holý",
        "specialty": "chirurgie"
      },
      {
        "name": "MUDr. Simona Navrátilová",
        "specialty": "radiologie, mamodiagnostika"
      },
      {
        "name": "Bc. Tereza Urbanová",
        "specialty": "koordinátorka KOC",
        "actor_id": "koord-horska"
      }
    ]
  },
  {
    "id": "mdt-uro-zapadni",
    "name": "MDT pro urologické nádory",
    "organization_id": "koc5-zapadni",
    "members": [
      {
        "name": "doc. MUDr. Karel Šťastný, Ph.D.",
        "specialty": "urologie"
      },
      {
        "name": "MUDr. Michaela Kubíčková",
        "specialty": "klinická onkologie"
      },
      {
        "name": "MUDr. Vojtěch Hanák",
        "specialty": "radiační onkologie"
      },
      {
        "name": "Bc. Ondřej Malík",
        "specialty": "koordinátor KOC",
        "actor_id": "koord-zapadni"
      }
    ]
  }
]
