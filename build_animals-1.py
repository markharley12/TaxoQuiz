#!/usr/bin/env python3
"""
Build a comprehensive animal taxonomy JSON dataset.
Uses a tree-based approach to ensure taxonomic consistency -
animals sharing a clade will always have identical clade names.

The taxonomy follows NCBI conventions.
"""

import json
import time
from pathlib import Path

OUTPUT_FILE = Path("/home/claude/animals.json")


def L(*pairs):
    """Build a lineage from (rank, name) pairs."""
    return [{"rank": r, "name": n} for r, n in pairs]


# ============================================================
# BASE LINEAGE PREFIXES - shared ancestry for major groups
# ============================================================

# Root
_animalia = [("Kingdom", "Animalia")]

# -- Phylum level --
_chordata = _animalia + [("Phylum", "Chordata"), ("Subphylum", "Vertebrata")]
_arthropoda = _animalia + [("Phylum", "Arthropoda")]
_mollusca = _animalia + [("Phylum", "Mollusca")]
_cnidaria = _animalia + [("Phylum", "Cnidaria")]
_echinodermata = _animalia + [("Phylum", "Echinodermata")]
_annelida = _animalia + [("Phylum", "Annelida")]
_porifera = _animalia + [("Phylum", "Porifera")]
_nematoda = _animalia + [("Phylum", "Nematoda")]
_platyhelminthes = _animalia + [("Phylum", "Platyhelminthes")]
_tardigrada = _animalia + [("Phylum", "Tardigrada")]
_rotifera = _animalia + [("Phylum", "Rotifera")]

# -- Chordata branches --
_gnathostomata = _chordata + [("Infraphylum", "Gnathostomata")]
_tetrapoda = _gnathostomata + [("Superclass", "Tetrapoda")]
_amniota = _tetrapoda + [("Clade", "Amniota")]

# -- Mammals --
_mammalia = _amniota + [("Class", "Mammalia")]
_theria = _mammalia + [("Subclass", "Theria")]
_eutheria = _theria + [("Infraclass", "Eutheria")]
_metatheria = _theria + [("Infraclass", "Metatheria")]
_prototheria = _mammalia + [("Subclass", "Prototheria")]

# Eutherian superorders
_boreoeutheria = _eutheria + [("Superorder", "Boreoeutheria")]
_laurasiatheria = _boreoeutheria + [("Clade", "Laurasiatheria")]
_euarchontoglires = _boreoeutheria + [("Clade", "Euarchontoglires")]
_afrotheria = _eutheria + [("Superorder", "Afrotheria")]
_xenarthra = _eutheria + [("Superorder", "Xenarthra")]

# Carnivora
_carnivora = _laurasiatheria + [("Order", "Carnivora")]
_feliformia = _carnivora + [("Suborder", "Feliformia")]
_caniformia = _carnivora + [("Suborder", "Caniformia")]

# Felidae
_felidae = _feliformia + [("Family", "Felidae")]
_pantherinae = _felidae + [("Subfamily", "Pantherinae")]
_felinae = _felidae + [("Subfamily", "Felinae")]

# Canidae
_canidae = _caniformia + [("Family", "Canidae")]

# Ursidae
_ursidae = _caniformia + [("Family", "Ursidae")]

# Mustelidae + relatives
_musteloidea = _caniformia + [("Superfamily", "Musteloidea")]
_mustelidae = _musteloidea + [("Family", "Mustelidae")]
_procyonidae = _musteloidea + [("Family", "Procyonidae")]
_mephitidae = _musteloidea + [("Family", "Mephitidae")]

# Pinnipedia
_pinnipedia = _caniformia + [("Clade", "Pinnipedia")]

# Other feliformia
_herpestidae = _feliformia + [("Family", "Herpestidae")]
_hyaenidae = _feliformia + [("Family", "Hyaenidae")]
_viverridae = _feliformia + [("Family", "Viverridae")]

# Primates
_primates = _euarchontoglires + [("Order", "Primates")]
_haplorhini = _primates + [("Suborder", "Haplorhini")]
_strepsirrhini = _primates + [("Suborder", "Strepsirrhini")]
_catarrhini = _haplorhini + [("Infraorder", "Catarrhini")]
_platyrrhini = _haplorhini + [("Infraorder", "Platyrrhini")]
_hominoidea = _catarrhini + [("Superfamily", "Hominoidea")]
_hominidae = _hominoidea + [("Family", "Hominidae")]
_cercopithecidae = _catarrhini + [("Superfamily", "Cercopithecoidea"), ("Family", "Cercopithecidae")]

# Rodentia
_rodentia = _euarchontoglires + [("Order", "Rodentia")]
_myomorpha = _rodentia + [("Suborder", "Myomorpha")]
_sciuromorpha = _rodentia + [("Suborder", "Sciuromorpha")]
_hystricomorpha = _rodentia + [("Suborder", "Hystricomorpha")]
_castorimorpha = _rodentia + [("Suborder", "Castorimorpha")]
_muridae = _myomorpha + [("Family", "Muridae")]
_cricetidae = _myomorpha + [("Family", "Cricetidae")]
_sciuridae = _sciuromorpha + [("Family", "Sciuridae")]

# Lagomorpha
_lagomorpha = _euarchontoglires + [("Order", "Lagomorpha")]

# Chiroptera
_chiroptera = _laurasiatheria + [("Order", "Chiroptera")]

# Perissodactyla
_perissodactyla = _laurasiatheria + [("Order", "Perissodactyla")]
_equidae = _perissodactyla + [("Family", "Equidae")]
_rhinocerotidae = _perissodactyla + [("Family", "Rhinocerotidae")]
_tapiridae = _perissodactyla + [("Family", "Tapiridae")]

# Artiodactyla (Cetartiodactyla)
_cetartiodactyla = _laurasiatheria + [("Order", "Cetartiodactyla")]
_ruminantia = _cetartiodactyla + [("Suborder", "Ruminantia")]
_suina = _cetartiodactyla + [("Suborder", "Suina")]
_tylopoda = _cetartiodactyla + [("Suborder", "Tylopoda")]
_whippomorpha = _cetartiodactyla + [("Clade", "Whippomorpha")]

# Ruminant families
_bovidae = _ruminantia + [("Family", "Bovidae")]
_cervidae = _ruminantia + [("Family", "Cervidae")]
_giraffidae = _ruminantia + [("Family", "Giraffidae")]
_antilocapridae = _ruminantia + [("Family", "Antilocapridae")]

# Cetacea
_cetacea = _whippomorpha + [("Infraorder", "Cetacea")]
_mysticeti = _cetacea + [("Parvorder", "Mysticeti")]
_odontoceti = _cetacea + [("Parvorder", "Odontoceti")]
_balaenopteridae = _mysticeti + [("Family", "Balaenopteridae")]
_delphinidae = _odontoceti + [("Family", "Delphinidae")]

# Suidae
_suidae = _suina + [("Family", "Suidae")]

# Hippopotamidae
_hippopotamidae = _whippomorpha + [("Family", "Hippopotamidae")]

# Eulipotyphla (hedgehogs, shrews, moles)
_eulipotyphla = _laurasiatheria + [("Order", "Eulipotyphla")]
_erinaceidae = _eulipotyphla + [("Family", "Erinaceidae")]
_soricidae = _eulipotyphla + [("Family", "Soricidae")]
_talpidae = _eulipotyphla + [("Family", "Talpidae")]

# Pholidota (pangolins)
_pholidota = _laurasiatheria + [("Order", "Pholidota")]

# Afrotheria orders
_proboscidea = _afrotheria + [("Order", "Proboscidea")]
_sirenia = _afrotheria + [("Order", "Sirenia")]
_hyracoidea = _afrotheria + [("Order", "Hyracoidea")]
_tubulidentata = _afrotheria + [("Order", "Tubulidentata")]
_afrosoricida = _afrotheria + [("Order", "Afrosoricida")]

# Xenarthra orders
_cingulata = _xenarthra + [("Order", "Cingulata")]
_pilosa = _xenarthra + [("Order", "Pilosa")]

# Marsupials
_dasyuromorphia = _metatheria + [("Order", "Dasyuromorphia")]
_diprotodontia = _metatheria + [("Order", "Diprotodontia")]
_didelphimorphia = _metatheria + [("Order", "Didelphimorphia")]
_peramelemorphia = _metatheria + [("Order", "Peramelemorphia")]

# -- Sauropsida (reptiles + birds) --
_sauropsida = _amniota + [("Class", "Sauropsida")]
_lepidosauria = _sauropsida + [("Subclass", "Lepidosauria")]
_archosauria = _sauropsida + [("Subclass", "Archosauria")]
_testudines = _sauropsida + [("Order", "Testudines")]

# Squamata (lizards + snakes)
_squamata = _lepidosauria + [("Order", "Squamata")]
_serpentes = _squamata + [("Suborder", "Serpentes")]
_lacertilia = _squamata + [("Suborder", "Lacertilia")]

# Snake families
_elapidae = _serpentes + [("Family", "Elapidae")]
_viperidae = _serpentes + [("Family", "Viperidae")]
_colubridae = _serpentes + [("Family", "Colubridae")]
_pythonidae = _serpentes + [("Family", "Pythonidae")]
_boidae = _serpentes + [("Family", "Boidae")]

# Lizard families
_iguanidae = _lacertilia + [("Family", "Iguanidae")]
_chamaeleonidae = _lacertilia + [("Family", "Chamaeleonidae")]
_gekkonidae = _lacertilia + [("Family", "Gekkonidae")]
_varanidae = _lacertilia + [("Family", "Varanidae")]
_agamidae = _lacertilia + [("Family", "Agamidae")]
_scincidae = _lacertilia + [("Family", "Scincidae")]
_helodermatidae = _lacertilia + [("Family", "Helodermatidae")]

# Rhynchocephalia (tuatara)
_rhynchocephalia = _lepidosauria + [("Order", "Rhynchocephalia")]

# Crocodilia
_crocodilia = _archosauria + [("Order", "Crocodilia")]
_crocodylidae = _crocodilia + [("Family", "Crocodylidae")]
_alligatoridae = _crocodilia + [("Family", "Alligatoridae")]
_gavialidae = _crocodilia + [("Family", "Gavialidae")]

# Birds
_aves = _archosauria + [("Order_Group", "Aves")]  # Using Order_Group to avoid Class clash

# Actually let's be more precise about birds. In NCBI, Aves is a class under Archosauria.
# Let me restructure. Birds in NCBI are nested within Sauropsida -> Archosauria.
# For simplicity and game purposes:

_aves = _archosauria + [("Clade", "Aves")]

# Bird orders
_passeriformes = _aves + [("Order", "Passeriformes")]
_accipitriformes = _aves + [("Order", "Accipitriformes")]
_falconiformes = _aves + [("Order", "Falconiformes")]
_strigiformes = _aves + [("Order", "Strigiformes")]
_psittaciformes = _aves + [("Order", "Psittaciformes")]
_columbiformes = _aves + [("Order", "Columbiformes")]
_piciformes = _aves + [("Order", "Piciformes")]
_apodiformes = _aves + [("Order", "Apodiformes")]
_coraciiformes = _aves + [("Order", "Coraciiformes")]
_galliformes = _aves + [("Order", "Galliformes")]
_anseriformes = _aves + [("Order", "Anseriformes")]
_sphenisciformes = _aves + [("Order", "Sphenisciformes")]
_procellariiformes = _aves + [("Order", "Procellariiformes")]
_pelecaniformes = _aves + [("Order", "Pelecaniformes")]
_ciconiiformes = _aves + [("Order", "Ciconiiformes")]
_gruiformes = _aves + [("Order", "Gruiformes")]
_charadriiformes = _aves + [("Order", "Charadriiformes")]
_phoenicopteriformes = _aves + [("Order", "Phoenicopteriformes")]
_struthioniformes = _aves + [("Order", "Struthioniformes")]
_casuariiformes = _aves + [("Order", "Casuariiformes")]
_apterygiformes = _aves + [("Order", "Apterygiformes")]
_rheiformes = _aves + [("Order", "Rheiformes")]
_cuculiformes = _aves + [("Order", "Cuculiformes")]
_bucerotiformes = _aves + [("Order", "Bucerotiformes")]
_trogoniformes = _aves + [("Order", "Trogoniformes")]
_suliformes = _aves + [("Order", "Suliformes")]
_cathartiformes = _aves + [("Order", "Cathartiformes")]

# Passerine families
_corvidae = _passeriformes + [("Family", "Corvidae")]
_turdidae = _passeriformes + [("Family", "Turdidae")]
_fringillidae = _passeriformes + [("Family", "Fringillidae")]
_passeridae = _passeriformes + [("Family", "Passeridae")]
_hirundinidae = _passeriformes + [("Family", "Hirundinidae")]
_paridae = _passeriformes + [("Family", "Paridae")]
_sturnidae = _passeriformes + [("Family", "Sturnidae")]
_cardinalidae = _passeriformes + [("Family", "Cardinalidae")]
_icteridae = _passeriformes + [("Family", "Icteridae")]
_troglodytidae = _passeriformes + [("Family", "Troglodytidae")]
_paradisaeidae = _passeriformes + [("Family", "Paradisaeidae")]
_muscicapidae = _passeriformes + [("Family", "Muscicapidae")]
_laniidae = _passeriformes + [("Family", "Laniidae")]
_bombycillidae = _passeriformes + [("Family", "Bombycillidae")]
_parulidae = _passeriformes + [("Family", "Parulidae")]
_tyrannidae = _passeriformes + [("Family", "Tyrannidae")]
_menuridae = _passeriformes + [("Family", "Menuridae")]

# Raptor families
_accipitridae = _accipitriformes + [("Family", "Accipitridae")]
_falconidae = _falconiformes + [("Family", "Falconidae")]
_strigidae = _strigiformes + [("Family", "Strigidae")]
_tytonidae = _strigiformes + [("Family", "Tytonidae")]

# Galliformes families
_phasianidae = _galliformes + [("Family", "Phasianidae")]
_meleagrididae = _galliformes + [("Family", "Meleagrididae")]

# Anseriformes
_anatidae = _anseriformes + [("Family", "Anatidae")]

# -- Amphibia --
_amphibia = _tetrapoda + [("Class", "Amphibia")]
_anura = _amphibia + [("Order", "Anura")]
_caudata = _amphibia + [("Order", "Caudata")]
_gymnophiona = _amphibia + [("Order", "Gymnophiona")]

# Frog families
_ranidae = _anura + [("Family", "Ranidae")]
_hylidae = _anura + [("Family", "Hylidae")]
_bufonidae = _anura + [("Family", "Bufonidae")]
_dendrobatidae = _anura + [("Family", "Dendrobatidae")]
_pipidae = _anura + [("Family", "Pipidae")]
_leptodactylidae = _anura + [("Family", "Leptodactylidae")]

# Salamander families
_salamandridae = _caudata + [("Family", "Salamandridae")]
_ambystomatidae = _caudata + [("Family", "Ambystomatidae")]
_cryptobranchidae = _caudata + [("Family", "Cryptobranchidae")]
_proteidae = _caudata + [("Family", "Proteidae")]
_plethodontidae = _caudata + [("Family", "Plethodontidae")]

# -- Fish --
# Bony fish
_actinopterygii = _gnathostomata + [("Class", "Actinopterygii")]
_teleostei = _actinopterygii + [("Subclass", "Teleostei")]

# Teleost orders
_perciformes = _teleostei + [("Order", "Perciformes")]
_salmoniformes = _teleostei + [("Order", "Salmoniformes")]
_cypriniformes = _teleostei + [("Order", "Cypriniformes")]
_siluriformes = _teleostei + [("Order", "Siluriformes")]
_clupeiformes = _teleostei + [("Order", "Clupeiformes")]
_gadiformes = _teleostei + [("Order", "Gadiformes")]
_pleuronectiformes = _teleostei + [("Order", "Pleuronectiformes")]
_tetraodontiformes = _teleostei + [("Order", "Tetraodontiformes")]
_anguilliformes = _teleostei + [("Order", "Anguilliformes")]
_syngnathiformes = _teleostei + [("Order", "Syngnathiformes")]
_lophiiformes = _teleostei + [("Order", "Lophiiformes")]
_esociformes = _teleostei + [("Order", "Esociformes")]
_osteoglossiformes = _teleostei + [("Order", "Osteoglossiformes")]
_beloniformes = _teleostei + [("Order", "Beloniformes")]
_scorpaeniformes = _teleostei + [("Order", "Scorpaeniformes")]
_gymnotiformes = _teleostei + [("Order", "Gymnotiformes")]
_characiformes = _teleostei + [("Order", "Characiformes")]
_cichliformes = _teleostei + [("Order", "Cichliformes")]
_scombriformes = _teleostei + [("Order", "Scombriformes")]

# Non-teleost bony fish
_acipenseriformes = _actinopterygii + [("Order", "Acipenseriformes")]
_lepisosteiformes = _actinopterygii + [("Order", "Lepisosteiformes")]
_amiiformes = _actinopterygii + [("Order", "Amiiformes")]
_polypteriformes = _actinopterygii + [("Order", "Polypteriformes")]

# Lobe-finned fish
_sarcopterygii = _gnathostomata + [("Class", "Sarcopterygii")]
_coelacanthiformes = _sarcopterygii + [("Order", "Coelacanthiformes")]
_ceratodontiformes = _sarcopterygii + [("Order", "Ceratodontiformes")]

# Cartilaginous fish
_chondrichthyes = _gnathostomata + [("Class", "Chondrichthyes")]
_selachimorpha = _chondrichthyes + [("Subclass", "Elasmobranchii"), ("Superorder", "Selachimorpha")]
_batoidea = _chondrichthyes + [("Subclass", "Elasmobranchii"), ("Superorder", "Batoidea")]
_holocephali = _chondrichthyes + [("Subclass", "Holocephali")]

# Shark orders
_lamniformes = _selachimorpha + [("Order", "Lamniformes")]
_carcharhiniformes = _selachimorpha + [("Order", "Carcharhiniformes")]
_orectolobiformes = _selachimorpha + [("Order", "Orectolobiformes")]
_squaliformes = _selachimorpha + [("Order", "Squaliformes")]
_squatiniformes = _selachimorpha + [("Order", "Squatiniformes")]
_heterodontiformes = _selachimorpha + [("Order", "Heterodontiformes")]
_hexanchiformes = _selachimorpha + [("Order", "Hexanchiformes")]

# Ray orders
_myliobatiformes = _batoidea + [("Order", "Myliobatiformes")]
_rajiformes = _batoidea + [("Order", "Rajiformes")]
_torpediniformes = _batoidea + [("Order", "Torpediniformes")]
_pristiformes = _batoidea + [("Order", "Pristiformes")]

# Jawless fish
_agnatha = _chordata + [("Infraphylum", "Agnatha")]
_petromyzontiformes = _agnatha + [("Class", "Hyperoartia"), ("Order", "Petromyzontiformes")]
_myxiniformes = _agnatha + [("Class", "Myxini"), ("Order", "Myxiniformes")]

# -- Arthropoda branches --
_hexapoda = _arthropoda + [("Subphylum", "Hexapoda")]
_insecta = _hexapoda + [("Class", "Insecta")]
_arachnida = _arthropoda + [("Subphylum", "Chelicerata"), ("Class", "Arachnida")]
_crustacea = _arthropoda + [("Subphylum", "Crustacea")]
_myriapoda = _arthropoda + [("Subphylum", "Myriapoda")]

# Insect orders
_coleoptera = _insecta + [("Order", "Coleoptera")]
_lepidoptera = _insecta + [("Order", "Lepidoptera")]
_hymenoptera = _insecta + [("Order", "Hymenoptera")]
_diptera = _insecta + [("Order", "Diptera")]
_orthoptera = _insecta + [("Order", "Orthoptera")]
_hemiptera = _insecta + [("Order", "Hemiptera")]
_odonata = _insecta + [("Order", "Odonata")]
_blattodea = _insecta + [("Order", "Blattodea")]
_mantodea = _insecta + [("Order", "Mantodea")]
_phasmatodea = _insecta + [("Order", "Phasmatodea")]
_dermaptera = _insecta + [("Order", "Dermaptera")]
_neuroptera = _insecta + [("Order", "Neuroptera")]
_siphonaptera = _insecta + [("Order", "Siphonaptera")]
_ephemeroptera = _insecta + [("Order", "Ephemeroptera")]
_trichoptera = _insecta + [("Order", "Trichoptera")]
_phthiraptera = _insecta + [("Order", "Phthiraptera")]

# Beetle families
_coccinellidae = _coleoptera + [("Family", "Coccinellidae")]
_lucanidae = _coleoptera + [("Family", "Lucanidae")]
_scarabaeidae = _coleoptera + [("Family", "Scarabaeidae")]
_lampyridae = _coleoptera + [("Family", "Lampyridae")]
_cerambycidae = _coleoptera + [("Family", "Cerambycidae")]
_curculionidae = _coleoptera + [("Family", "Curculionidae")]
_chrysomelidae = _coleoptera + [("Family", "Chrysomelidae")]
_dytiscidae = _coleoptera + [("Family", "Dytiscidae")]

# Lepidoptera families
_nymphalidae = _lepidoptera + [("Family", "Nymphalidae")]
_papilionidae = _lepidoptera + [("Family", "Papilionidae")]
_pieridae = _lepidoptera + [("Family", "Pieridae")]
_saturniidae = _lepidoptera + [("Family", "Saturniidae")]
_sphingidae = _lepidoptera + [("Family", "Sphingidae")]
_noctuidae = _lepidoptera + [("Family", "Noctuidae")]
_bombycidae = _lepidoptera + [("Family", "Bombycidae")]

# Hymenoptera families
_apidae = _hymenoptera + [("Family", "Apidae")]
_formicidae = _hymenoptera + [("Family", "Formicidae")]
_vespidae = _hymenoptera + [("Family", "Vespidae")]

# Diptera families
_muscidae = _diptera + [("Family", "Muscidae")]
_culicidae = _diptera + [("Family", "Culicidae")]
_drosophilidae = _diptera + [("Family", "Drosophilidae")]

# Arachnid orders
_araneae = _arachnida + [("Order", "Araneae")]
_scorpiones = _arachnida + [("Order", "Scorpiones")]
_ixodida = _arachnida + [("Order", "Ixodida")]
_opiliones = _arachnida + [("Order", "Opiliones")]
_solifugae = _arachnida + [("Order", "Solifugae")]

# Spider families
_theraphosidae = _araneae + [("Family", "Theraphosidae")]
_theridiidae = _araneae + [("Family", "Theridiidae")]
_araneidae = _araneae + [("Family", "Araneidae")]
_salticidae = _araneae + [("Family", "Salticidae")]
_sicariidae = _araneae + [("Family", "Sicariidae")]

# Crustacean classes/orders
_malacostraca = _crustacea + [("Class", "Malacostraca")]
_decapoda = _malacostraca + [("Order", "Decapoda")]
_isopoda = _malacostraca + [("Order", "Isopoda")]
_amphipoda = _malacostraca + [("Order", "Amphipoda")]
_stomatopoda = _malacostraca + [("Order", "Stomatopoda")]
_euphausiacea = _malacostraca + [("Order", "Euphausiacea")]
_maxillopoda = _crustacea + [("Class", "Maxillopoda")]
_branchiopoda = _crustacea + [("Class", "Branchiopoda")]

# Myriapoda classes
_chilopoda = _myriapoda + [("Class", "Chilopoda")]
_diplopoda = _myriapoda + [("Class", "Diplopoda")]

# -- Mollusca classes --
_cephalopoda = _mollusca + [("Class", "Cephalopoda")]
_gastropoda = _mollusca + [("Class", "Gastropoda")]
_bivalvia = _mollusca + [("Class", "Bivalvia")]

# Cephalopod orders
_octopoda = _cephalopoda + [("Order", "Octopoda")]
_teuthida = _cephalopoda + [("Order", "Oegopsida")]
_sepiida = _cephalopoda + [("Order", "Sepiida")]
_nautilida = _cephalopoda + [("Order", "Nautilida")]

# -- Cnidaria classes --
_scyphozoa = _cnidaria + [("Class", "Scyphozoa")]
_anthozoa = _cnidaria + [("Class", "Anthozoa")]
_hydrozoa = _cnidaria + [("Class", "Hydrozoa")]
_cubozoa = _cnidaria + [("Class", "Cubozoa")]

# -- Echinodermata classes --
_asteroidea = _echinodermata + [("Class", "Asteroidea")]
_echinoidea = _echinodermata + [("Class", "Echinoidea")]
_holothuroidea = _echinodermata + [("Class", "Holothuroidea")]
_ophiuroidea = _echinodermata + [("Class", "Ophiuroidea")]
_crinoidea = _echinodermata + [("Class", "Crinoidea")]


# ============================================================
# SPECIES DATABASE
# Each entry: (common_name, scientific_name, lineage_prefix + [(rank, name), ...])
# ============================================================

def sp(common_name, scientific_name, base, *extra):
    """Create a species entry, appending genus and species to the base lineage."""
    lineage = list(base)
    for rank, name in extra:
        lineage.append((rank, name))
    return {
        "common_name": common_name,
        "scientific_name": scientific_name,
        "lineage": L(*lineage),
    }


SPECIES = [
    # ========== MAMMALS ==========

    # -- Felidae --
    sp("lion", "Panthera leo", _pantherinae, ("Genus", "Panthera"), ("Species", "Panthera leo")),
    sp("tiger", "Panthera tigris", _pantherinae, ("Genus", "Panthera"), ("Species", "Panthera tigris")),
    sp("leopard", "Panthera pardus", _pantherinae, ("Genus", "Panthera"), ("Species", "Panthera pardus")),
    sp("jaguar", "Panthera onca", _pantherinae, ("Genus", "Panthera"), ("Species", "Panthera onca")),
    sp("snow leopard", "Panthera uncia", _pantherinae, ("Genus", "Panthera"), ("Species", "Panthera uncia")),
    sp("clouded leopard", "Neofelis nebulosa", _pantherinae, ("Genus", "Neofelis"), ("Species", "Neofelis nebulosa")),
    sp("cheetah", "Acinonyx jubatus", _felinae, ("Genus", "Acinonyx"), ("Species", "Acinonyx jubatus")),
    sp("cougar", "Puma concolor", _felinae, ("Genus", "Puma"), ("Species", "Puma concolor")),
    sp("domestic cat", "Felis catus", _felinae, ("Genus", "Felis"), ("Species", "Felis catus")),
    sp("lynx", "Lynx lynx", _felinae, ("Genus", "Lynx"), ("Species", "Lynx lynx")),
    sp("bobcat", "Lynx rufus", _felinae, ("Genus", "Lynx"), ("Species", "Lynx rufus")),
    sp("ocelot", "Leopardus pardalis", _felinae, ("Genus", "Leopardus"), ("Species", "Leopardus pardalis")),
    sp("serval", "Leptailurus serval", _felinae, ("Genus", "Leptailurus"), ("Species", "Leptailurus serval")),
    sp("caracal", "Caracal caracal", _felinae, ("Genus", "Caracal"), ("Species", "Caracal caracal")),
    sp("sand cat", "Felis margarita", _felinae, ("Genus", "Felis"), ("Species", "Felis margarita")),

    # -- Canidae --
    sp("dog", "Canis lupus familiaris", _canidae, ("Genus", "Canis"), ("Species", "Canis lupus familiaris")),
    sp("grey wolf", "Canis lupus", _canidae, ("Genus", "Canis"), ("Species", "Canis lupus")),
    sp("red fox", "Vulpes vulpes", _canidae, ("Genus", "Vulpes"), ("Species", "Vulpes vulpes")),
    sp("arctic fox", "Vulpes lagopus", _canidae, ("Genus", "Vulpes"), ("Species", "Vulpes lagopus")),
    sp("coyote", "Canis latrans", _canidae, ("Genus", "Canis"), ("Species", "Canis latrans")),
    sp("jackal", "Canis aureus", _canidae, ("Genus", "Canis"), ("Species", "Canis aureus")),
    sp("african wild dog", "Lycaon pictus", _canidae, ("Genus", "Lycaon"), ("Species", "Lycaon pictus")),
    sp("fennec fox", "Vulpes zerda", _canidae, ("Genus", "Vulpes"), ("Species", "Vulpes zerda")),
    sp("dingo", "Canis lupus dingo", _canidae, ("Genus", "Canis"), ("Species", "Canis lupus dingo")),
    sp("maned wolf", "Chrysocyon brachyurus", _canidae, ("Genus", "Chrysocyon"), ("Species", "Chrysocyon brachyurus")),

    # -- Ursidae --
    sp("brown bear", "Ursus arctos", _ursidae, ("Genus", "Ursus"), ("Species", "Ursus arctos")),
    sp("polar bear", "Ursus maritimus", _ursidae, ("Genus", "Ursus"), ("Species", "Ursus maritimus")),
    sp("black bear", "Ursus americanus", _ursidae, ("Genus", "Ursus"), ("Species", "Ursus americanus")),
    sp("giant panda", "Ailuropoda melanoleuca", _ursidae, ("Genus", "Ailuropoda"), ("Species", "Ailuropoda melanoleuca")),
    sp("sun bear", "Helarctos malayanus", _ursidae, ("Genus", "Helarctos"), ("Species", "Helarctos malayanus")),
    sp("spectacled bear", "Tremarctos ornatus", _ursidae, ("Genus", "Tremarctos"), ("Species", "Tremarctos ornatus")),
    sp("sloth bear", "Melursus ursinus", _ursidae, ("Genus", "Melursus"), ("Species", "Melursus ursinus")),
    sp("asian black bear", "Ursus thibetanus", _ursidae, ("Genus", "Ursus"), ("Species", "Ursus thibetanus")),

    # -- Mustelidae + relatives --
    sp("weasel", "Mustela nivalis", _mustelidae, ("Genus", "Mustela"), ("Species", "Mustela nivalis")),
    sp("ferret", "Mustela putorius furo", _mustelidae, ("Genus", "Mustela"), ("Species", "Mustela putorius furo")),
    sp("stoat", "Mustela erminea", _mustelidae, ("Genus", "Mustela"), ("Species", "Mustela erminea")),
    sp("european badger", "Meles meles", _mustelidae, ("Genus", "Meles"), ("Species", "Meles meles")),
    sp("honey badger", "Mellivora capensis", _mustelidae, ("Genus", "Mellivora"), ("Species", "Mellivora capensis")),
    sp("wolverine", "Gulo gulo", _mustelidae, ("Genus", "Gulo"), ("Species", "Gulo gulo")),
    sp("sea otter", "Enhydra lutris", _mustelidae, ("Genus", "Enhydra"), ("Species", "Enhydra lutris")),
    sp("european otter", "Lutra lutra", _mustelidae, ("Genus", "Lutra"), ("Species", "Lutra lutra")),
    sp("pine marten", "Martes martes", _mustelidae, ("Genus", "Martes"), ("Species", "Martes martes")),
    sp("raccoon", "Procyon lotor", _procyonidae, ("Genus", "Procyon"), ("Species", "Procyon lotor")),
    sp("kinkajou", "Potos flavus", _procyonidae, ("Genus", "Potos"), ("Species", "Potos flavus")),
    sp("coati", "Nasua nasua", _procyonidae, ("Genus", "Nasua"), ("Species", "Nasua nasua")),
    sp("striped skunk", "Mephitis mephitis", _mephitidae, ("Genus", "Mephitis"), ("Species", "Mephitis mephitis")),
    sp("red panda", "Ailurus fulgens", _musteloidea + [("Family", "Ailuridae")], ("Genus", "Ailurus"), ("Species", "Ailurus fulgens")),

    # -- Other Feliformia --
    sp("meerkat", "Suricata suricatta", _herpestidae, ("Genus", "Suricata"), ("Species", "Suricata suricatta")),
    sp("mongoose", "Herpestes ichneumon", _herpestidae, ("Genus", "Herpestes"), ("Species", "Herpestes ichneumon")),
    sp("spotted hyena", "Crocuta crocuta", _hyaenidae, ("Genus", "Crocuta"), ("Species", "Crocuta crocuta")),
    sp("striped hyena", "Hyaena hyaena", _hyaenidae, ("Genus", "Hyaena"), ("Species", "Hyaena hyaena")),
    sp("aardwolf", "Proteles cristata", _hyaenidae, ("Genus", "Proteles"), ("Species", "Proteles cristata")),
    sp("civet", "Civettictis civetta", _viverridae, ("Genus", "Civettictis"), ("Species", "Civettictis civetta")),
    sp("fossa", "Cryptoprocta ferox", _feliformia + [("Family", "Eupleridae")], ("Genus", "Cryptoprocta"), ("Species", "Cryptoprocta ferox")),

    # -- Pinnipedia --
    sp("harbour seal", "Phoca vitulina", _pinnipedia + [("Family", "Phocidae")], ("Genus", "Phoca"), ("Species", "Phoca vitulina")),
    sp("grey seal", "Halichoerus grypus", _pinnipedia + [("Family", "Phocidae")], ("Genus", "Halichoerus"), ("Species", "Halichoerus grypus")),
    sp("elephant seal", "Mirounga angustirostris", _pinnipedia + [("Family", "Phocidae")], ("Genus", "Mirounga"), ("Species", "Mirounga angustirostris")),
    sp("leopard seal", "Hydrurga leptonyx", _pinnipedia + [("Family", "Phocidae")], ("Genus", "Hydrurga"), ("Species", "Hydrurga leptonyx")),
    sp("walrus", "Odobenus rosmarus", _pinnipedia + [("Family", "Odobenidae")], ("Genus", "Odobenus"), ("Species", "Odobenus rosmarus")),
    sp("california sea lion", "Zalophus californianus", _pinnipedia + [("Family", "Otariidae")], ("Genus", "Zalophus"), ("Species", "Zalophus californianus")),

    # -- Primates --
    sp("human", "Homo sapiens", _hominidae, ("Subfamily", "Homininae"), ("Genus", "Homo"), ("Species", "Homo sapiens")),
    sp("chimpanzee", "Pan troglodytes", _hominidae, ("Subfamily", "Homininae"), ("Genus", "Pan"), ("Species", "Pan troglodytes")),
    sp("bonobo", "Pan paniscus", _hominidae, ("Subfamily", "Homininae"), ("Genus", "Pan"), ("Species", "Pan paniscus")),
    sp("gorilla", "Gorilla gorilla", _hominidae, ("Subfamily", "Homininae"), ("Genus", "Gorilla"), ("Species", "Gorilla gorilla")),
    sp("orangutan", "Pongo pygmaeus", _hominidae, ("Subfamily", "Ponginae"), ("Genus", "Pongo"), ("Species", "Pongo pygmaeus")),
    sp("gibbon", "Hylobates lar", _hominoidea + [("Family", "Hylobatidae")], ("Genus", "Hylobates"), ("Species", "Hylobates lar")),
    sp("baboon", "Papio anubis", _cercopithecidae, ("Genus", "Papio"), ("Species", "Papio anubis")),
    sp("mandrill", "Mandrillus sphinx", _cercopithecidae, ("Genus", "Mandrillus"), ("Species", "Mandrillus sphinx")),
    sp("macaque", "Macaca mulatta", _cercopithecidae, ("Genus", "Macaca"), ("Species", "Macaca mulatta")),
    sp("proboscis monkey", "Nasalis larvatus", _cercopithecidae, ("Genus", "Nasalis"), ("Species", "Nasalis larvatus")),
    sp("colobus monkey", "Colobus guereza", _cercopithecidae, ("Genus", "Colobus"), ("Species", "Colobus guereza")),
    sp("spider monkey", "Ateles geoffroyi", _platyrrhini + [("Family", "Atelidae")], ("Genus", "Ateles"), ("Species", "Ateles geoffroyi")),
    sp("howler monkey", "Alouatta caraya", _platyrrhini + [("Family", "Atelidae")], ("Genus", "Alouatta"), ("Species", "Alouatta caraya")),
    sp("capuchin", "Cebus capucinus", _platyrrhini + [("Family", "Cebidae")], ("Genus", "Cebus"), ("Species", "Cebus capucinus")),
    sp("squirrel monkey", "Saimiri sciureus", _platyrrhini + [("Family", "Cebidae")], ("Genus", "Saimiri"), ("Species", "Saimiri sciureus")),
    sp("marmoset", "Callithrix jacchus", _platyrrhini + [("Family", "Callitrichidae")], ("Genus", "Callithrix"), ("Species", "Callithrix jacchus")),
    sp("tamarin", "Saguinus oedipus", _platyrrhini + [("Family", "Callitrichidae")], ("Genus", "Saguinus"), ("Species", "Saguinus oedipus")),
    sp("tarsier", "Carlito syrichta", _haplorhini + [("Infraorder", "Tarsiiformes"), ("Family", "Tarsiidae")], ("Genus", "Carlito"), ("Species", "Carlito syrichta")),
    sp("ring-tailed lemur", "Lemur catta", _strepsirrhini + [("Family", "Lemuridae")], ("Genus", "Lemur"), ("Species", "Lemur catta")),
    sp("aye-aye", "Daubentonia madagascariensis", _strepsirrhini + [("Family", "Daubentoniidae")], ("Genus", "Daubentonia"), ("Species", "Daubentonia madagascariensis")),
    sp("slow loris", "Nycticebus coucang", _strepsirrhini + [("Family", "Lorisidae")], ("Genus", "Nycticebus"), ("Species", "Nycticebus coucang")),

    # -- Rodentia --
    sp("house mouse", "Mus musculus", _muridae, ("Genus", "Mus"), ("Species", "Mus musculus")),
    sp("brown rat", "Rattus norvegicus", _muridae, ("Genus", "Rattus"), ("Species", "Rattus norvegicus")),
    sp("hamster", "Mesocricetus auratus", _cricetidae, ("Genus", "Mesocricetus"), ("Species", "Mesocricetus auratus")),
    sp("guinea pig", "Cavia porcellus", _hystricomorpha + [("Family", "Caviidae")], ("Genus", "Cavia"), ("Species", "Cavia porcellus")),
    sp("capybara", "Hydrochoerus hydrochaeris", _hystricomorpha + [("Family", "Caviidae")], ("Genus", "Hydrochoerus"), ("Species", "Hydrochoerus hydrochaeris")),
    sp("chinchilla", "Chinchilla lanigera", _hystricomorpha + [("Family", "Chinchillidae")], ("Genus", "Chinchilla"), ("Species", "Chinchilla lanigera")),
    sp("porcupine", "Hystrix cristata", _hystricomorpha + [("Family", "Hystricidae")], ("Genus", "Hystrix"), ("Species", "Hystrix cristata")),
    sp("naked mole rat", "Heterocephalus glaber", _hystricomorpha + [("Family", "Heterocephalidae")], ("Genus", "Heterocephalus"), ("Species", "Heterocephalus glaber")),
    sp("grey squirrel", "Sciurus carolinensis", _sciuridae, ("Genus", "Sciurus"), ("Species", "Sciurus carolinensis")),
    sp("red squirrel", "Sciurus vulgaris", _sciuridae, ("Genus", "Sciurus"), ("Species", "Sciurus vulgaris")),
    sp("chipmunk", "Tamias striatus", _sciuridae, ("Genus", "Tamias"), ("Species", "Tamias striatus")),
    sp("prairie dog", "Cynomys ludovicianus", _sciuridae, ("Genus", "Cynomys"), ("Species", "Cynomys ludovicianus")),
    sp("groundhog", "Marmota monax", _sciuridae, ("Genus", "Marmota"), ("Species", "Marmota monax")),
    sp("flying squirrel", "Pteromys volans", _sciuridae, ("Genus", "Pteromys"), ("Species", "Pteromys volans")),
    sp("beaver", "Castor canadensis", _castorimorpha + [("Family", "Castoridae")], ("Genus", "Castor"), ("Species", "Castor canadensis")),
    sp("gerbil", "Meriones unguiculatus", _muridae, ("Genus", "Meriones"), ("Species", "Meriones unguiculatus")),
    sp("jerboa", "Jaculus jaculus", _myomorpha + [("Family", "Dipodidae")], ("Genus", "Jaculus"), ("Species", "Jaculus jaculus")),

    # -- Lagomorpha --
    sp("rabbit", "Oryctolagus cuniculus", _lagomorpha + [("Family", "Leporidae")], ("Genus", "Oryctolagus"), ("Species", "Oryctolagus cuniculus")),
    sp("hare", "Lepus europaeus", _lagomorpha + [("Family", "Leporidae")], ("Genus", "Lepus"), ("Species", "Lepus europaeus")),
    sp("pika", "Ochotona princeps", _lagomorpha + [("Family", "Ochotonidae")], ("Genus", "Ochotona"), ("Species", "Ochotona princeps")),

    # -- Chiroptera --
    sp("common pipistrelle", "Pipistrellus pipistrellus", _chiroptera + [("Family", "Vespertilionidae")], ("Genus", "Pipistrellus"), ("Species", "Pipistrellus pipistrellus")),
    sp("fruit bat", "Pteropus vampyrus", _chiroptera + [("Family", "Pteropodidae")], ("Genus", "Pteropus"), ("Species", "Pteropus vampyrus")),
    sp("vampire bat", "Desmodus rotundus", _chiroptera + [("Family", "Phyllostomidae")], ("Genus", "Desmodus"), ("Species", "Desmodus rotundus")),
    sp("horseshoe bat", "Rhinolophus ferrumequinum", _chiroptera + [("Family", "Rhinolophidae")], ("Genus", "Rhinolophus"), ("Species", "Rhinolophus ferrumequinum")),

    # -- Equidae --
    sp("horse", "Equus caballus", _equidae, ("Genus", "Equus"), ("Species", "Equus caballus")),
    sp("donkey", "Equus asinus", _equidae, ("Genus", "Equus"), ("Species", "Equus asinus")),
    sp("zebra", "Equus quagga", _equidae, ("Genus", "Equus"), ("Species", "Equus quagga")),

    # -- Rhinocerotidae --
    sp("white rhinoceros", "Ceratotherium simum", _rhinocerotidae, ("Genus", "Ceratotherium"), ("Species", "Ceratotherium simum")),
    sp("black rhinoceros", "Diceros bicornis", _rhinocerotidae, ("Genus", "Diceros"), ("Species", "Diceros bicornis")),
    sp("indian rhinoceros", "Rhinoceros unicornis", _rhinocerotidae, ("Genus", "Rhinoceros"), ("Species", "Rhinoceros unicornis")),

    # -- Tapiridae --
    sp("tapir", "Tapirus terrestris", _tapiridae, ("Genus", "Tapirus"), ("Species", "Tapirus terrestris")),

    # -- Cetartiodactyla: Ruminants --
    sp("cow", "Bos taurus", _bovidae, ("Subfamily", "Bovinae"), ("Genus", "Bos"), ("Species", "Bos taurus")),
    sp("water buffalo", "Bubalus bubalis", _bovidae, ("Subfamily", "Bovinae"), ("Genus", "Bubalus"), ("Species", "Bubalus bubalis")),
    sp("bison", "Bison bison", _bovidae, ("Subfamily", "Bovinae"), ("Genus", "Bison"), ("Species", "Bison bison")),
    sp("yak", "Bos grunniens", _bovidae, ("Subfamily", "Bovinae"), ("Genus", "Bos"), ("Species", "Bos grunniens")),
    sp("goat", "Capra aegagrus hircus", _bovidae, ("Subfamily", "Caprinae"), ("Genus", "Capra"), ("Species", "Capra aegagrus hircus")),
    sp("sheep", "Ovis aries", _bovidae, ("Subfamily", "Caprinae"), ("Genus", "Ovis"), ("Species", "Ovis aries")),
    sp("muskox", "Ovibos moschatus", _bovidae, ("Subfamily", "Caprinae"), ("Genus", "Ovibos"), ("Species", "Ovibos moschatus")),
    sp("impala", "Aepyceros melampus", _bovidae, ("Subfamily", "Aepycerotinae"), ("Genus", "Aepyceros"), ("Species", "Aepyceros melampus")),
    sp("wildebeest", "Connochaetes taurinus", _bovidae, ("Subfamily", "Alcelaphinae"), ("Genus", "Connochaetes"), ("Species", "Connochaetes taurinus")),
    sp("gazelle", "Gazella gazella", _bovidae, ("Subfamily", "Antilopinae"), ("Genus", "Gazella"), ("Species", "Gazella gazella")),
    sp("springbok", "Antidorcas marsupialis", _bovidae, ("Subfamily", "Antilopinae"), ("Genus", "Antidorcas"), ("Species", "Antidorcas marsupialis")),
    sp("oryx", "Oryx gazella", _bovidae, ("Subfamily", "Hippotraginae"), ("Genus", "Oryx"), ("Species", "Oryx gazella")),
    sp("kudu", "Tragelaphus strepsiceros", _bovidae, ("Subfamily", "Bovinae"), ("Genus", "Tragelaphus"), ("Species", "Tragelaphus strepsiceros")),
    sp("red deer", "Cervus elaphus", _cervidae, ("Genus", "Cervus"), ("Species", "Cervus elaphus")),
    sp("moose", "Alces alces", _cervidae, ("Genus", "Alces"), ("Species", "Alces alces")),
    sp("reindeer", "Rangifer tarandus", _cervidae, ("Genus", "Rangifer"), ("Species", "Rangifer tarandus")),
    sp("roe deer", "Capreolus capreolus", _cervidae, ("Genus", "Capreolus"), ("Species", "Capreolus capreolus")),
    sp("fallow deer", "Dama dama", _cervidae, ("Genus", "Dama"), ("Species", "Dama dama")),
    sp("muntjac", "Muntiacus reevesi", _cervidae, ("Genus", "Muntiacus"), ("Species", "Muntiacus reevesi")),
    sp("giraffe", "Giraffa camelopardalis", _giraffidae, ("Genus", "Giraffa"), ("Species", "Giraffa camelopardalis")),
    sp("okapi", "Okapia johnstoni", _giraffidae, ("Genus", "Okapia"), ("Species", "Okapia johnstoni")),
    sp("pronghorn", "Antilocapra americana", _antilocapridae, ("Genus", "Antilocapra"), ("Species", "Antilocapra americana")),

    # -- Suidae --
    sp("pig", "Sus scrofa domesticus", _suidae, ("Genus", "Sus"), ("Species", "Sus scrofa domesticus")),
    sp("wild boar", "Sus scrofa", _suidae, ("Genus", "Sus"), ("Species", "Sus scrofa")),
    sp("warthog", "Phacochoerus africanus", _suidae, ("Genus", "Phacochoerus"), ("Species", "Phacochoerus africanus")),
    sp("babirusa", "Babyrousa babyrussa", _suidae, ("Genus", "Babyrousa"), ("Species", "Babyrousa babyrussa")),
    sp("peccary", "Pecari tajacu", _cetartiodactyla + [("Suborder", "Suina"), ("Family", "Tayassuidae")], ("Genus", "Pecari"), ("Species", "Pecari tajacu")),

    # -- Hippopotamidae --
    sp("hippopotamus", "Hippopotamus amphibius", _hippopotamidae, ("Genus", "Hippopotamus"), ("Species", "Hippopotamus amphibius")),
    sp("pygmy hippopotamus", "Choeropsis liberiensis", _hippopotamidae, ("Genus", "Choeropsis"), ("Species", "Choeropsis liberiensis")),

    # -- Tylopoda --
    sp("dromedary camel", "Camelus dromedarius", _tylopoda + [("Family", "Camelidae")], ("Genus", "Camelus"), ("Species", "Camelus dromedarius")),
    sp("bactrian camel", "Camelus bactrianus", _tylopoda + [("Family", "Camelidae")], ("Genus", "Camelus"), ("Species", "Camelus bactrianus")),
    sp("llama", "Lama glama", _tylopoda + [("Family", "Camelidae")], ("Genus", "Lama"), ("Species", "Lama glama")),
    sp("alpaca", "Vicugna pacos", _tylopoda + [("Family", "Camelidae")], ("Genus", "Vicugna"), ("Species", "Vicugna pacos")),

    # -- Cetacea --
    sp("blue whale", "Balaenoptera musculus", _balaenopteridae, ("Genus", "Balaenoptera"), ("Species", "Balaenoptera musculus")),
    sp("humpback whale", "Megaptera novaeangliae", _balaenopteridae, ("Genus", "Megaptera"), ("Species", "Megaptera novaeangliae")),
    sp("fin whale", "Balaenoptera physalus", _balaenopteridae, ("Genus", "Balaenoptera"), ("Species", "Balaenoptera physalus")),
    sp("minke whale", "Balaenoptera acutorostrata", _balaenopteridae, ("Genus", "Balaenoptera"), ("Species", "Balaenoptera acutorostrata")),
    sp("right whale", "Eubalaena glacialis", _mysticeti + [("Family", "Balaenidae")], ("Genus", "Eubalaena"), ("Species", "Eubalaena glacialis")),
    sp("grey whale", "Eschrichtius robustus", _mysticeti + [("Family", "Eschrichtiidae")], ("Genus", "Eschrichtius"), ("Species", "Eschrichtius robustus")),
    sp("bottlenose dolphin", "Tursiops truncatus", _delphinidae, ("Genus", "Tursiops"), ("Species", "Tursiops truncatus")),
    sp("orca", "Orcinus orca", _delphinidae, ("Genus", "Orcinus"), ("Species", "Orcinus orca")),
    sp("common dolphin", "Delphinus delphis", _delphinidae, ("Genus", "Delphinus"), ("Species", "Delphinus delphis")),
    sp("narwhal", "Monodon monoceros", _odontoceti + [("Family", "Monodontidae")], ("Genus", "Monodon"), ("Species", "Monodon monoceros")),
    sp("beluga whale", "Delphinapterus leucas", _odontoceti + [("Family", "Monodontidae")], ("Genus", "Delphinapterus"), ("Species", "Delphinapterus leucas")),
    sp("sperm whale", "Physeter macrocephalus", _odontoceti + [("Family", "Physeteridae")], ("Genus", "Physeter"), ("Species", "Physeter macrocephalus")),
    sp("harbour porpoise", "Phocoena phocoena", _odontoceti + [("Family", "Phocoenidae")], ("Genus", "Phocoena"), ("Species", "Phocoena phocoena")),

    # -- Eulipotyphla --
    sp("hedgehog", "Erinaceus europaeus", _erinaceidae, ("Genus", "Erinaceus"), ("Species", "Erinaceus europaeus")),
    sp("common shrew", "Sorex araneus", _soricidae, ("Genus", "Sorex"), ("Species", "Sorex araneus")),
    sp("european mole", "Talpa europaea", _talpidae, ("Genus", "Talpa"), ("Species", "Talpa europaea")),
    sp("star-nosed mole", "Condylura cristata", _talpidae, ("Genus", "Condylura"), ("Species", "Condylura cristata")),

    # -- Pholidota --
    sp("pangolin", "Manis javanica", _pholidota + [("Family", "Manidae")], ("Genus", "Manis"), ("Species", "Manis javanica")),

    # -- Afrotheria --
    sp("african elephant", "Loxodonta africana", _proboscidea + [("Family", "Elephantidae")], ("Genus", "Loxodonta"), ("Species", "Loxodonta africana")),
    sp("asian elephant", "Elephas maximus", _proboscidea + [("Family", "Elephantidae")], ("Genus", "Elephas"), ("Species", "Elephas maximus")),
    sp("manatee", "Trichechus manatus", _sirenia + [("Family", "Trichechidae")], ("Genus", "Trichechus"), ("Species", "Trichechus manatus")),
    sp("dugong", "Dugong dugon", _sirenia + [("Family", "Dugongidae")], ("Genus", "Dugong"), ("Species", "Dugong dugon")),
    sp("rock hyrax", "Procavia capensis", _hyracoidea + [("Family", "Procaviidae")], ("Genus", "Procavia"), ("Species", "Procavia capensis")),
    sp("aardvark", "Orycteropus afer", _tubulidentata + [("Family", "Orycteropodidae")], ("Genus", "Orycteropus"), ("Species", "Orycteropus afer")),
    sp("tenrec", "Tenrec ecaudatus", _afrosoricida + [("Family", "Tenrecidae")], ("Genus", "Tenrec"), ("Species", "Tenrec ecaudatus")),

    # -- Xenarthra --
    sp("nine-banded armadillo", "Dasypus novemcinctus", _cingulata + [("Family", "Dasypodidae")], ("Genus", "Dasypus"), ("Species", "Dasypus novemcinctus")),
    sp("giant armadillo", "Priodontes maximus", _cingulata + [("Family", "Chlamyphoridae")], ("Genus", "Priodontes"), ("Species", "Priodontes maximus")),
    sp("three-toed sloth", "Bradypus variegatus", _pilosa + [("Family", "Bradypodidae")], ("Genus", "Bradypus"), ("Species", "Bradypus variegatus")),
    sp("two-toed sloth", "Choloepus hoffmanni", _pilosa + [("Family", "Megalonychidae")], ("Genus", "Choloepus"), ("Species", "Choloepus hoffmanni")),
    sp("giant anteater", "Myrmecophaga tridactyla", _pilosa + [("Family", "Myrmecophagidae")], ("Genus", "Myrmecophaga"), ("Species", "Myrmecophaga tridactyla")),

    # -- Marsupials --
    sp("red kangaroo", "Macropus rufus", _diprotodontia + [("Family", "Macropodidae")], ("Genus", "Macropus"), ("Species", "Macropus rufus")),
    sp("wallaby", "Macropus agilis", _diprotodontia + [("Family", "Macropodidae")], ("Genus", "Macropus"), ("Species", "Macropus agilis")),
    sp("koala", "Phascolarctos cinereus", _diprotodontia + [("Family", "Phascolarctidae")], ("Genus", "Phascolarctos"), ("Species", "Phascolarctos cinereus")),
    sp("wombat", "Vombatus ursinus", _diprotodontia + [("Family", "Vombatidae")], ("Genus", "Vombatus"), ("Species", "Vombatus ursinus")),
    sp("quokka", "Setonix brachyurus", _diprotodontia + [("Family", "Macropodidae")], ("Genus", "Setonix"), ("Species", "Setonix brachyurus")),
    sp("sugar glider", "Petaurus breviceps", _diprotodontia + [("Family", "Petauridae")], ("Genus", "Petaurus"), ("Species", "Petaurus breviceps")),
    sp("tasmanian devil", "Sarcophilus harrisii", _dasyuromorphia + [("Family", "Dasyuridae")], ("Genus", "Sarcophilus"), ("Species", "Sarcophilus harrisii")),
    sp("quoll", "Dasyurus viverrinus", _dasyuromorphia + [("Family", "Dasyuridae")], ("Genus", "Dasyurus"), ("Species", "Dasyurus viverrinus")),
    sp("numbat", "Myrmecobius fasciatus", _dasyuromorphia + [("Family", "Myrmecobiidae")], ("Genus", "Myrmecobius"), ("Species", "Myrmecobius fasciatus")),
    sp("virginia opossum", "Didelphis virginiana", _didelphimorphia + [("Family", "Didelphidae")], ("Genus", "Didelphis"), ("Species", "Didelphis virginiana")),
    sp("bilby", "Macrotis lagotis", _peramelemorphia + [("Family", "Thylacomyidae")], ("Genus", "Macrotis"), ("Species", "Macrotis lagotis")),
    sp("thylacine", "Thylacinus cynocephalus", _dasyuromorphia + [("Family", "Thylacinidae")], ("Genus", "Thylacinus"), ("Species", "Thylacinus cynocephalus")),

    # -- Monotremes --
    sp("platypus", "Ornithorhynchus anatinus", _prototheria + [("Order", "Monotremata"), ("Family", "Ornithorhynchidae")], ("Genus", "Ornithorhynchus"), ("Species", "Ornithorhynchus anatinus")),
    sp("echidna", "Tachyglossus aculeatus", _prototheria + [("Order", "Monotremata"), ("Family", "Tachyglossidae")], ("Genus", "Tachyglossus"), ("Species", "Tachyglossus aculeatus")),

    # ========== BIRDS ==========

    # -- Raptors --
    sp("bald eagle", "Haliaeetus leucocephalus", _accipitridae, ("Genus", "Haliaeetus"), ("Species", "Haliaeetus leucocephalus")),
    sp("golden eagle", "Aquila chrysaetos", _accipitridae, ("Genus", "Aquila"), ("Species", "Aquila chrysaetos")),
    sp("red-tailed hawk", "Buteo jamaicensis", _accipitridae, ("Genus", "Buteo"), ("Species", "Buteo jamaicensis")),
    sp("sparrowhawk", "Accipiter nisus", _accipitridae, ("Genus", "Accipiter"), ("Species", "Accipiter nisus")),
    sp("osprey", "Pandion haliaetus", _accipitridae, ("Genus", "Pandion"), ("Species", "Pandion haliaetus")),
    sp("harpy eagle", "Harpia harpyja", _accipitridae, ("Genus", "Harpia"), ("Species", "Harpia harpyja")),
    sp("red kite", "Milvus milvus", _accipitridae, ("Genus", "Milvus"), ("Species", "Milvus milvus")),
    sp("secretary bird", "Sagittarius serpentarius", _accipitriformes + [("Family", "Sagittariidae")], ("Genus", "Sagittarius"), ("Species", "Sagittarius serpentarius")),
    sp("peregrine falcon", "Falco peregrinus", _falconidae, ("Genus", "Falco"), ("Species", "Falco peregrinus")),
    sp("kestrel", "Falco tinnunculus", _falconidae, ("Genus", "Falco"), ("Species", "Falco tinnunculus")),
    sp("barn owl", "Tyto alba", _tytonidae, ("Genus", "Tyto"), ("Species", "Tyto alba")),
    sp("snowy owl", "Bubo scandiacus", _strigidae, ("Genus", "Bubo"), ("Species", "Bubo scandiacus")),
    sp("great horned owl", "Bubo virginianus", _strigidae, ("Genus", "Bubo"), ("Species", "Bubo virginianus")),
    sp("tawny owl", "Strix aluco", _strigidae, ("Genus", "Strix"), ("Species", "Strix aluco")),
    sp("burrowing owl", "Athene cunicularia", _strigidae, ("Genus", "Athene"), ("Species", "Athene cunicularia")),
    sp("condor", "Vultur gryphus", _cathartiformes + [("Family", "Cathartidae")], ("Genus", "Vultur"), ("Species", "Vultur gryphus")),
    sp("turkey vulture", "Cathartes aura", _cathartiformes + [("Family", "Cathartidae")], ("Genus", "Cathartes"), ("Species", "Cathartes aura")),

    # -- Passerines --
    sp("european robin", "Erithacus rubecula", _muscicapidae, ("Genus", "Erithacus"), ("Species", "Erithacus rubecula")),
    sp("nightingale", "Luscinia megarhynchos", _muscicapidae, ("Genus", "Luscinia"), ("Species", "Luscinia megarhynchos")),
    sp("common blackbird", "Turdus merula", _turdidae, ("Genus", "Turdus"), ("Species", "Turdus merula")),
    sp("song thrush", "Turdus philomelos", _turdidae, ("Genus", "Turdus"), ("Species", "Turdus philomelos")),
    sp("american robin", "Turdus migratorius", _turdidae, ("Genus", "Turdus"), ("Species", "Turdus migratorius")),
    sp("carrion crow", "Corvus corone", _corvidae, ("Genus", "Corvus"), ("Species", "Corvus corone")),
    sp("common raven", "Corvus corax", _corvidae, ("Genus", "Corvus"), ("Species", "Corvus corax")),
    sp("magpie", "Pica pica", _corvidae, ("Genus", "Pica"), ("Species", "Pica pica")),
    sp("blue jay", "Cyanocitta cristata", _corvidae, ("Genus", "Cyanocitta"), ("Species", "Cyanocitta cristata")),
    sp("jackdaw", "Corvus monedula", _corvidae, ("Genus", "Corvus"), ("Species", "Corvus monedula")),
    sp("house sparrow", "Passer domesticus", _passeridae, ("Genus", "Passer"), ("Species", "Passer domesticus")),
    sp("goldfinch", "Carduelis carduelis", _fringillidae, ("Genus", "Carduelis"), ("Species", "Carduelis carduelis")),
    sp("chaffinch", "Fringilla coelebs", _fringillidae, ("Genus", "Fringilla"), ("Species", "Fringilla coelebs")),
    sp("barn swallow", "Hirundo rustica", _hirundinidae, ("Genus", "Hirundo"), ("Species", "Hirundo rustica")),
    sp("blue tit", "Cyanistes caeruleus", _paridae, ("Genus", "Cyanistes"), ("Species", "Cyanistes caeruleus")),
    sp("great tit", "Parus major", _paridae, ("Genus", "Parus"), ("Species", "Parus major")),
    sp("starling", "Sturnus vulgaris", _sturnidae, ("Genus", "Sturnus"), ("Species", "Sturnus vulgaris")),
    sp("northern cardinal", "Cardinalis cardinalis", _cardinalidae, ("Genus", "Cardinalis"), ("Species", "Cardinalis cardinalis")),
    sp("wren", "Troglodytes troglodytes", _troglodytidae, ("Genus", "Troglodytes"), ("Species", "Troglodytes troglodytes")),
    sp("bird of paradise", "Paradisaea apoda", _paradisaeidae, ("Genus", "Paradisaea"), ("Species", "Paradisaea apoda")),
    sp("shrike", "Lanius collurio", _laniidae, ("Genus", "Lanius"), ("Species", "Lanius collurio")),
    sp("lyrebird", "Menura novaehollandiae", _menuridae, ("Genus", "Menura"), ("Species", "Menura novaehollandiae")),
    sp("cedar waxwing", "Bombycilla cedrorum", _bombycillidae, ("Genus", "Bombycilla"), ("Species", "Bombycilla cedrorum")),

    # -- Parrots --
    sp("african grey parrot", "Psittacus erithacus", _psittaciformes + [("Family", "Psittacidae")], ("Genus", "Psittacus"), ("Species", "Psittacus erithacus")),
    sp("budgerigar", "Melopsittacus undulatus", _psittaciformes + [("Family", "Psittaculidae")], ("Genus", "Melopsittacus"), ("Species", "Melopsittacus undulatus")),
    sp("scarlet macaw", "Ara macao", _psittaciformes + [("Family", "Psittacidae")], ("Genus", "Ara"), ("Species", "Ara macao")),
    sp("cockatoo", "Cacatua galerita", _psittaciformes + [("Family", "Cacatuidae")], ("Genus", "Cacatua"), ("Species", "Cacatua galerita")),
    sp("kakapo", "Strigops habroptila", _psittaciformes + [("Family", "Strigopidae")], ("Genus", "Strigops"), ("Species", "Strigops habroptila")),
    sp("kea", "Nestor notabilis", _psittaciformes + [("Family", "Strigopidae")], ("Genus", "Nestor"), ("Species", "Nestor notabilis")),

    # -- Waterbirds --
    sp("emperor penguin", "Aptenodytes forsteri", _sphenisciformes + [("Family", "Spheniscidae")], ("Genus", "Aptenodytes"), ("Species", "Aptenodytes forsteri")),
    sp("king penguin", "Aptenodytes patagonicus", _sphenisciformes + [("Family", "Spheniscidae")], ("Genus", "Aptenodytes"), ("Species", "Aptenodytes patagonicus")),
    sp("rockhopper penguin", "Eudyptes chrysocome", _sphenisciformes + [("Family", "Spheniscidae")], ("Genus", "Eudyptes"), ("Species", "Eudyptes chrysocome")),
    sp("albatross", "Diomedea exulans", _procellariiformes + [("Family", "Diomedeidae")], ("Genus", "Diomedea"), ("Species", "Diomedea exulans")),
    sp("puffin", "Fratercula arctica", _charadriiformes + [("Family", "Alcidae")], ("Genus", "Fratercula"), ("Species", "Fratercula arctica")),
    sp("pelican", "Pelecanus onocrotalus", _pelecaniformes + [("Family", "Pelecanidae")], ("Genus", "Pelecanus"), ("Species", "Pelecanus onocrotalus")),
    sp("grey heron", "Ardea cinerea", _pelecaniformes + [("Family", "Ardeidae")], ("Genus", "Ardea"), ("Species", "Ardea cinerea")),
    sp("great blue heron", "Ardea herodias", _pelecaniformes + [("Family", "Ardeidae")], ("Genus", "Ardea"), ("Species", "Ardea herodias")),
    sp("flamingo", "Phoenicopterus roseus", _phoenicopteriformes + [("Family", "Phoenicopteridae")], ("Genus", "Phoenicopterus"), ("Species", "Phoenicopterus roseus")),
    sp("white stork", "Ciconia ciconia", _ciconiiformes + [("Family", "Ciconiidae")], ("Genus", "Ciconia"), ("Species", "Ciconia ciconia")),
    sp("crane", "Grus grus", _gruiformes + [("Family", "Gruidae")], ("Genus", "Grus"), ("Species", "Grus grus")),
    sp("mute swan", "Cygnus olor", _anatidae, ("Genus", "Cygnus"), ("Species", "Cygnus olor")),
    sp("mallard", "Anas platyrhynchos", _anatidae, ("Genus", "Anas"), ("Species", "Anas platyrhynchos")),
    sp("canada goose", "Branta canadensis", _anatidae, ("Genus", "Branta"), ("Species", "Branta canadensis")),
    sp("mandarin duck", "Aix galericulata", _anatidae, ("Genus", "Aix"), ("Species", "Aix galericulata")),
    sp("cormorant", "Phalacrocorax carbo", _suliformes + [("Family", "Phalacrocoracidae")], ("Genus", "Phalacrocorax"), ("Species", "Phalacrocorax carbo")),
    sp("gannet", "Morus bassanus", _suliformes + [("Family", "Sulidae")], ("Genus", "Morus"), ("Species", "Morus bassanus")),
    sp("frigatebird", "Fregata magnificens", _suliformes + [("Family", "Fregatidae")], ("Genus", "Fregata"), ("Species", "Fregata magnificens")),
    sp("herring gull", "Larus argentatus", _charadriiformes + [("Family", "Laridae")], ("Genus", "Larus"), ("Species", "Larus argentatus")),

    # -- Other birds --
    sp("pigeon", "Columba livia", _columbiformes + [("Family", "Columbidae")], ("Genus", "Columba"), ("Species", "Columba livia")),
    sp("turtle dove", "Streptopelia turtur", _columbiformes + [("Family", "Columbidae")], ("Genus", "Streptopelia"), ("Species", "Streptopelia turtur")),
    sp("great spotted woodpecker", "Dendrocopos major", _piciformes + [("Family", "Picidae")], ("Genus", "Dendrocopos"), ("Species", "Dendrocopos major")),
    sp("toucan", "Ramphastos toco", _piciformes + [("Family", "Ramphastidae")], ("Genus", "Ramphastos"), ("Species", "Ramphastos toco")),
    sp("hummingbird", "Archilochus colubris", _apodiformes + [("Family", "Trochilidae")], ("Genus", "Archilochus"), ("Species", "Archilochus colubris")),
    sp("common swift", "Apus apus", _apodiformes + [("Family", "Apodidae")], ("Genus", "Apus"), ("Species", "Apus apus")),
    sp("kingfisher", "Alcedo atthis", _coraciiformes + [("Family", "Alcedinidae")], ("Genus", "Alcedo"), ("Species", "Alcedo atthis")),
    sp("bee-eater", "Merops apiaster", _coraciiformes + [("Family", "Meropidae")], ("Genus", "Merops"), ("Species", "Merops apiaster")),
    sp("hornbill", "Buceros rhinoceros", _bucerotiformes + [("Family", "Bucerotidae")], ("Genus", "Buceros"), ("Species", "Buceros rhinoceros")),
    sp("hoopoe", "Upupa epops", _bucerotiformes + [("Family", "Upupidae")], ("Genus", "Upupa"), ("Species", "Upupa epops")),
    sp("cuckoo", "Cuculus canorus", _cuculiformes + [("Family", "Cuculidae")], ("Genus", "Cuculus"), ("Species", "Cuculus canorus")),
    sp("roadrunner", "Geococcyx californianus", _cuculiformes + [("Family", "Cuculidae")], ("Genus", "Geococcyx"), ("Species", "Geococcyx californianus")),
    sp("chicken", "Gallus gallus domesticus", _phasianidae, ("Genus", "Gallus"), ("Species", "Gallus gallus domesticus")),
    sp("peacock", "Pavo cristatus", _phasianidae, ("Genus", "Pavo"), ("Species", "Pavo cristatus")),
    sp("pheasant", "Phasianus colchicus", _phasianidae, ("Genus", "Phasianus"), ("Species", "Phasianus colchicus")),
    sp("quail", "Coturnix coturnix", _phasianidae, ("Genus", "Coturnix"), ("Species", "Coturnix coturnix")),
    sp("turkey", "Meleagris gallopavo", _galliformes + [("Family", "Phasianidae")], ("Genus", "Meleagris"), ("Species", "Meleagris gallopavo")),
    sp("ostrich", "Struthio camelus", _struthioniformes + [("Family", "Struthionidae")], ("Genus", "Struthio"), ("Species", "Struthio camelus")),
    sp("emu", "Dromaius novaehollandiae", _casuariiformes + [("Family", "Dromaiidae")], ("Genus", "Dromaius"), ("Species", "Dromaius novaehollandiae")),
    sp("cassowary", "Casuarius casuarius", _casuariiformes + [("Family", "Casuariidae")], ("Genus", "Casuarius"), ("Species", "Casuarius casuarius")),
    sp("kiwi", "Apteryx mantelli", _apterygiformes + [("Family", "Apterygidae")], ("Genus", "Apteryx"), ("Species", "Apteryx mantelli")),
    sp("rhea", "Rhea americana", _rheiformes + [("Family", "Rheidae")], ("Genus", "Rhea"), ("Species", "Rhea americana")),

    # ========== REPTILES ==========

    # -- Snakes --
    sp("king cobra", "Ophiophagus hannah", _elapidae, ("Genus", "Ophiophagus"), ("Species", "Ophiophagus hannah")),
    sp("black mamba", "Dendroaspis polylepis", _elapidae, ("Genus", "Dendroaspis"), ("Species", "Dendroaspis polylepis")),
    sp("coral snake", "Micrurus fulvius", _elapidae, ("Genus", "Micrurus"), ("Species", "Micrurus fulvius")),
    sp("inland taipan", "Oxyuranus microlepidotus", _elapidae, ("Genus", "Oxyuranus"), ("Species", "Oxyuranus microlepidotus")),
    sp("rattlesnake", "Crotalus atrox", _viperidae, ("Genus", "Crotalus"), ("Species", "Crotalus atrox")),
    sp("copperhead", "Agkistrodon contortrix", _viperidae, ("Genus", "Agkistrodon"), ("Species", "Agkistrodon contortrix")),
    sp("gaboon viper", "Bitis gabonica", _viperidae, ("Genus", "Bitis"), ("Species", "Bitis gabonica")),
    sp("puff adder", "Bitis arietans", _viperidae, ("Genus", "Bitis"), ("Species", "Bitis arietans")),
    sp("sidewinder", "Crotalus cerastes", _viperidae, ("Genus", "Crotalus"), ("Species", "Crotalus cerastes")),
    sp("king snake", "Lampropeltis getula", _colubridae, ("Genus", "Lampropeltis"), ("Species", "Lampropeltis getula")),
    sp("corn snake", "Pantherophis guttatus", _colubridae, ("Genus", "Pantherophis"), ("Species", "Pantherophis guttatus")),
    sp("garter snake", "Thamnophis sirtalis", _colubridae, ("Genus", "Thamnophis"), ("Species", "Thamnophis sirtalis")),
    sp("grass snake", "Natrix natrix", _colubridae, ("Genus", "Natrix"), ("Species", "Natrix natrix")),
    sp("boomslang", "Dispholidus typus", _colubridae, ("Genus", "Dispholidus"), ("Species", "Dispholidus typus")),
    sp("ball python", "Python regius", _pythonidae, ("Genus", "Python"), ("Species", "Python regius")),
    sp("burmese python", "Python bivittatus", _pythonidae, ("Genus", "Python"), ("Species", "Python bivittatus")),
    sp("reticulated python", "Malayopython reticulatus", _pythonidae, ("Genus", "Malayopython"), ("Species", "Malayopython reticulatus")),
    sp("boa constrictor", "Boa constrictor", _boidae, ("Genus", "Boa"), ("Species", "Boa constrictor")),
    sp("green anaconda", "Eunectes murinus", _boidae, ("Genus", "Eunectes"), ("Species", "Eunectes murinus")),

    # -- Lizards --
    sp("komodo dragon", "Varanus komodoensis", _varanidae, ("Genus", "Varanus"), ("Species", "Varanus komodoensis")),
    sp("nile monitor", "Varanus niloticus", _varanidae, ("Genus", "Varanus"), ("Species", "Varanus niloticus")),
    sp("green iguana", "Iguana iguana", _iguanidae, ("Genus", "Iguana"), ("Species", "Iguana iguana")),
    sp("marine iguana", "Amblyrhynchus cristatus", _iguanidae, ("Genus", "Amblyrhynchus"), ("Species", "Amblyrhynchus cristatus")),
    sp("chameleon", "Chamaeleo chamaeleon", _chamaeleonidae, ("Genus", "Chamaeleo"), ("Species", "Chamaeleo chamaeleon")),
    sp("panther chameleon", "Furcifer pardalis", _chamaeleonidae, ("Genus", "Furcifer"), ("Species", "Furcifer pardalis")),
    sp("leopard gecko", "Eublepharis macularius", _gekkonidae, ("Genus", "Eublepharis"), ("Species", "Eublepharis macularius")),
    sp("tokay gecko", "Gekko gecko", _gekkonidae, ("Genus", "Gekko"), ("Species", "Gekko gecko")),
    sp("bearded dragon", "Pogona vitticeps", _agamidae, ("Genus", "Pogona"), ("Species", "Pogona vitticeps")),
    sp("frilled lizard", "Chlamydosaurus kingii", _agamidae, ("Genus", "Chlamydosaurus"), ("Species", "Chlamydosaurus kingii")),
    sp("blue-tongued skink", "Tiliqua scincoides", _scincidae, ("Genus", "Tiliqua"), ("Species", "Tiliqua scincoides")),
    sp("gila monster", "Heloderma suspectum", _helodermatidae, ("Genus", "Heloderma"), ("Species", "Heloderma suspectum")),
    sp("glass lizard", "Ophisaurus ventralis", _lacertilia + [("Family", "Anguidae")], ("Genus", "Ophisaurus"), ("Species", "Ophisaurus ventralis")),

    # -- Turtles --
    sp("green sea turtle", "Chelonia mydas", _testudines + [("Family", "Cheloniidae")], ("Genus", "Chelonia"), ("Species", "Chelonia mydas")),
    sp("leatherback turtle", "Dermochelys coriacea", _testudines + [("Family", "Dermochelyidae")], ("Genus", "Dermochelys"), ("Species", "Dermochelys coriacea")),
    sp("galapagos tortoise", "Chelonoidis niger", _testudines + [("Family", "Testudinidae")], ("Genus", "Chelonoidis"), ("Species", "Chelonoidis niger")),
    sp("red-eared slider", "Trachemys scripta elegans", _testudines + [("Family", "Emydidae")], ("Genus", "Trachemys"), ("Species", "Trachemys scripta elegans")),
    sp("snapping turtle", "Chelydra serpentina", _testudines + [("Family", "Chelydridae")], ("Genus", "Chelydra"), ("Species", "Chelydra serpentina")),
    sp("box turtle", "Terrapene carolina", _testudines + [("Family", "Emydidae")], ("Genus", "Terrapene"), ("Species", "Terrapene carolina")),
    sp("aldabra tortoise", "Aldabrachelys gigantea", _testudines + [("Family", "Testudinidae")], ("Genus", "Aldabrachelys"), ("Species", "Aldabrachelys gigantea")),

    # -- Crocodilians --
    sp("saltwater crocodile", "Crocodylus porosus", _crocodylidae, ("Genus", "Crocodylus"), ("Species", "Crocodylus porosus")),
    sp("nile crocodile", "Crocodylus niloticus", _crocodylidae, ("Genus", "Crocodylus"), ("Species", "Crocodylus niloticus")),
    sp("american alligator", "Alligator mississippiensis", _alligatoridae, ("Genus", "Alligator"), ("Species", "Alligator mississippiensis")),
    sp("caiman", "Caiman crocodilus", _alligatoridae, ("Genus", "Caiman"), ("Species", "Caiman crocodilus")),
    sp("gharial", "Gavialis gangeticus", _gavialidae, ("Genus", "Gavialis"), ("Species", "Gavialis gangeticus")),

    # -- Tuatara --
    sp("tuatara", "Sphenodon punctatus", _rhynchocephalia + [("Family", "Sphenodontidae")], ("Genus", "Sphenodon"), ("Species", "Sphenodon punctatus")),

    # ========== AMPHIBIANS ==========
    sp("common frog", "Rana temporaria", _ranidae, ("Genus", "Rana"), ("Species", "Rana temporaria")),
    sp("bullfrog", "Lithobates catesbeianus", _ranidae, ("Genus", "Lithobates"), ("Species", "Lithobates catesbeianus")),
    sp("red-eyed tree frog", "Agalychnis callidryas", _hylidae, ("Genus", "Agalychnis"), ("Species", "Agalychnis callidryas")),
    sp("green tree frog", "Litoria caerulea", _hylidae, ("Genus", "Litoria"), ("Species", "Litoria caerulea")),
    sp("common toad", "Bufo bufo", _bufonidae, ("Genus", "Bufo"), ("Species", "Bufo bufo")),
    sp("cane toad", "Rhinella marina", _bufonidae, ("Genus", "Rhinella"), ("Species", "Rhinella marina")),
    sp("poison dart frog", "Dendrobates tinctorius", _dendrobatidae, ("Genus", "Dendrobates"), ("Species", "Dendrobates tinctorius")),
    sp("golden poison frog", "Phyllobates terribilis", _dendrobatidae, ("Genus", "Phyllobates"), ("Species", "Phyllobates terribilis")),
    sp("african clawed frog", "Xenopus laevis", _pipidae, ("Genus", "Xenopus"), ("Species", "Xenopus laevis")),
    sp("surinam toad", "Pipa pipa", _pipidae, ("Genus", "Pipa"), ("Species", "Pipa pipa")),
    sp("fire salamander", "Salamandra salamandra", _salamandridae, ("Genus", "Salamandra"), ("Species", "Salamandra salamandra")),
    sp("great crested newt", "Triturus cristatus", _salamandridae, ("Genus", "Triturus"), ("Species", "Triturus cristatus")),
    sp("smooth newt", "Lissotriton vulgaris", _salamandridae, ("Genus", "Lissotriton"), ("Species", "Lissotriton vulgaris")),
    sp("axolotl", "Ambystoma mexicanum", _ambystomatidae, ("Genus", "Ambystoma"), ("Species", "Ambystoma mexicanum")),
    sp("tiger salamander", "Ambystoma tigrinum", _ambystomatidae, ("Genus", "Ambystoma"), ("Species", "Ambystoma tigrinum")),
    sp("japanese giant salamander", "Andrias japonicus", _cryptobranchidae, ("Genus", "Andrias"), ("Species", "Andrias japonicus")),
    sp("hellbender", "Cryptobranchus alleganiensis", _cryptobranchidae, ("Genus", "Cryptobranchus"), ("Species", "Cryptobranchus alleganiensis")),
    sp("mudpuppy", "Necturus maculosus", _proteidae, ("Genus", "Necturus"), ("Species", "Necturus maculosus")),
    sp("olm", "Proteus anguinus", _proteidae, ("Genus", "Proteus"), ("Species", "Proteus anguinus")),
    sp("caecilian", "Caecilia tentaculata", _gymnophiona + [("Family", "Caeciliidae")], ("Genus", "Caecilia"), ("Species", "Caecilia tentaculata")),

    # ========== FISH ==========

    # -- Sharks --
    sp("great white shark", "Carcharodon carcharias", _lamniformes + [("Family", "Lamnidae")], ("Genus", "Carcharodon"), ("Species", "Carcharodon carcharias")),
    sp("shortfin mako shark", "Isurus oxyrinchus", _lamniformes + [("Family", "Lamnidae")], ("Genus", "Isurus"), ("Species", "Isurus oxyrinchus")),
    sp("basking shark", "Cetorhinus maximus", _lamniformes + [("Family", "Cetorhinidae")], ("Genus", "Cetorhinus"), ("Species", "Cetorhinus maximus")),
    sp("thresher shark", "Alopias vulpinus", _lamniformes + [("Family", "Alopiidae")], ("Genus", "Alopias"), ("Species", "Alopias vulpinus")),
    sp("hammerhead shark", "Sphyrna mokarran", _carcharhiniformes + [("Family", "Sphyrnidae")], ("Genus", "Sphyrna"), ("Species", "Sphyrna mokarran")),
    sp("bull shark", "Carcharhinus leucas", _carcharhiniformes + [("Family", "Carcharhinidae")], ("Genus", "Carcharhinus"), ("Species", "Carcharhinus leucas")),
    sp("tiger shark", "Galeocerdo cuvier", _carcharhiniformes + [("Family", "Carcharhinidae")], ("Genus", "Galeocerdo"), ("Species", "Galeocerdo cuvier")),
    sp("blue shark", "Prionace glauca", _carcharhiniformes + [("Family", "Carcharhinidae")], ("Genus", "Prionace"), ("Species", "Prionace glauca")),
    sp("whale shark", "Rhincodon typus", _orectolobiformes + [("Family", "Rhincodontidae")], ("Genus", "Rhincodon"), ("Species", "Rhincodon typus")),
    sp("nurse shark", "Ginglymostoma cirratum", _orectolobiformes + [("Family", "Ginglymostomatidae")], ("Genus", "Ginglymostoma"), ("Species", "Ginglymostoma cirratum")),
    sp("greenland shark", "Somniosus microcephalus", _squaliformes + [("Family", "Somniosidae")], ("Genus", "Somniosus"), ("Species", "Somniosus microcephalus")),
    sp("angel shark", "Squatina squatina", _squatiniformes + [("Family", "Squatinidae")], ("Genus", "Squatina"), ("Species", "Squatina squatina")),
    sp("horn shark", "Heterodontus francisci", _heterodontiformes + [("Family", "Heterodontidae")], ("Genus", "Heterodontus"), ("Species", "Heterodontus francisci")),

    # -- Rays --
    sp("manta ray", "Mobula birostris", _myliobatiformes + [("Family", "Mobulidae")], ("Genus", "Mobula"), ("Species", "Mobula birostris")),
    sp("stingray", "Dasyatis pastinaca", _myliobatiformes + [("Family", "Dasyatidae")], ("Genus", "Dasyatis"), ("Species", "Dasyatis pastinaca")),
    sp("electric ray", "Torpedo torpedo", _torpediniformes + [("Family", "Torpedinidae")], ("Genus", "Torpedo"), ("Species", "Torpedo torpedo")),
    sp("sawfish", "Pristis pristis", _pristiformes + [("Family", "Pristidae")], ("Genus", "Pristis"), ("Species", "Pristis pristis")),

    # -- Bony fish --
    sp("atlantic salmon", "Salmo salar", _salmoniformes + [("Family", "Salmonidae")], ("Genus", "Salmo"), ("Species", "Salmo salar")),
    sp("rainbow trout", "Oncorhynchus mykiss", _salmoniformes + [("Family", "Salmonidae")], ("Genus", "Oncorhynchus"), ("Species", "Oncorhynchus mykiss")),
    sp("atlantic cod", "Gadus morhua", _gadiformes + [("Family", "Gadidae")], ("Genus", "Gadus"), ("Species", "Gadus morhua")),
    sp("haddock", "Melanogrammus aeglefinus", _gadiformes + [("Family", "Gadidae")], ("Genus", "Melanogrammus"), ("Species", "Melanogrammus aeglefinus")),
    sp("bluefin tuna", "Thunnus thynnus", _scombriformes + [("Family", "Scombridae")], ("Genus", "Thunnus"), ("Species", "Thunnus thynnus")),
    sp("swordfish", "Xiphias gladius", _scombriformes + [("Family", "Xiphiidae")], ("Genus", "Xiphias"), ("Species", "Xiphias gladius")),
    sp("mackerel", "Scomber scombrus", _scombriformes + [("Family", "Scombridae")], ("Genus", "Scomber"), ("Species", "Scomber scombrus")),
    sp("common carp", "Cyprinus carpio", _cypriniformes + [("Family", "Cyprinidae")], ("Genus", "Cyprinus"), ("Species", "Cyprinus carpio")),
    sp("goldfish", "Carassius auratus", _cypriniformes + [("Family", "Cyprinidae")], ("Genus", "Carassius"), ("Species", "Carassius auratus")),
    sp("channel catfish", "Ictalurus punctatus", _siluriformes + [("Family", "Ictaluridae")], ("Genus", "Ictalurus"), ("Species", "Ictalurus punctatus")),
    sp("electric catfish", "Malapterurus electricus", _siluriformes + [("Family", "Malapteruridae")], ("Genus", "Malapterurus"), ("Species", "Malapterurus electricus")),
    sp("northern pike", "Esox lucius", _esociformes + [("Family", "Esocidae")], ("Genus", "Esox"), ("Species", "Esox lucius")),
    sp("clownfish", "Amphiprion ocellaris", _perciformes + [("Family", "Pomacentridae")], ("Genus", "Amphiprion"), ("Species", "Amphiprion ocellaris")),
    sp("anglerfish", "Lophius piscatorius", _lophiiformes + [("Family", "Lophiidae")], ("Genus", "Lophius"), ("Species", "Lophius piscatorius")),
    sp("seahorse", "Hippocampus kuda", _syngnathiformes + [("Family", "Syngnathidae")], ("Genus", "Hippocampus"), ("Species", "Hippocampus kuda")),
    sp("pipefish", "Syngnathus acus", _syngnathiformes + [("Family", "Syngnathidae")], ("Genus", "Syngnathus"), ("Species", "Syngnathus acus")),
    sp("pufferfish", "Tetraodon nigroviridis", _tetraodontiformes + [("Family", "Tetraodontidae")], ("Genus", "Tetraodon"), ("Species", "Tetraodon nigroviridis")),
    sp("ocean sunfish", "Mola mola", _tetraodontiformes + [("Family", "Molidae")], ("Genus", "Mola"), ("Species", "Mola mola")),
    sp("moray eel", "Muraena helena", _anguilliformes + [("Family", "Muraenidae")], ("Genus", "Muraena"), ("Species", "Muraena helena")),
    sp("european eel", "Anguilla anguilla", _anguilliformes + [("Family", "Anguillidae")], ("Genus", "Anguilla"), ("Species", "Anguilla anguilla")),
    sp("flying fish", "Exocoetus volitans", _beloniformes + [("Family", "Exocoetidae")], ("Genus", "Exocoetus"), ("Species", "Exocoetus volitans")),
    sp("barracuda", "Sphyraena barracuda", _perciformes + [("Family", "Sphyraenidae")], ("Genus", "Sphyraena"), ("Species", "Sphyraena barracuda")),
    sp("piranha", "Pygocentrus nattereri", _characiformes + [("Family", "Serrasalmidae")], ("Genus", "Pygocentrus"), ("Species", "Pygocentrus nattereri")),
    sp("electric eel", "Electrophorus electricus", _gymnotiformes + [("Family", "Gymnotidae")], ("Genus", "Electrophorus"), ("Species", "Electrophorus electricus")),
    sp("arapaima", "Arapaima gigas", _osteoglossiformes + [("Family", "Osteoglossidae")], ("Genus", "Arapaima"), ("Species", "Arapaima gigas")),
    sp("herring", "Clupea harengus", _clupeiformes + [("Family", "Clupeidae")], ("Genus", "Clupea"), ("Species", "Clupea harengus")),
    sp("anchovy", "Engraulis encrasicolus", _clupeiformes + [("Family", "Engraulidae")], ("Genus", "Engraulis"), ("Species", "Engraulis encrasicolus")),
    sp("plaice", "Pleuronectes platessa", _pleuronectiformes + [("Family", "Pleuronectidae")], ("Genus", "Pleuronectes"), ("Species", "Pleuronectes platessa")),
    sp("halibut", "Hippoglossus hippoglossus", _pleuronectiformes + [("Family", "Pleuronectidae")], ("Genus", "Hippoglossus"), ("Species", "Hippoglossus hippoglossus")),
    sp("lionfish", "Pterois volitans", _scorpaeniformes + [("Family", "Scorpaenidae")], ("Genus", "Pterois"), ("Species", "Pterois volitans")),
    sp("oscar", "Astronotus ocellatus", _cichliformes + [("Family", "Cichlidae")], ("Genus", "Astronotus"), ("Species", "Astronotus ocellatus")),
    sp("tilapia", "Oreochromis niloticus", _cichliformes + [("Family", "Cichlidae")], ("Genus", "Oreochromis"), ("Species", "Oreochromis niloticus")),
    sp("perch", "Perca fluviatilis", _perciformes + [("Family", "Percidae")], ("Genus", "Perca"), ("Species", "Perca fluviatilis")),
    sp("bass", "Micropterus salmoides", _perciformes + [("Family", "Centrarchidae")], ("Genus", "Micropterus"), ("Species", "Micropterus salmoides")),

    # -- Primitive fish --
    sp("sturgeon", "Acipenser sturio", _acipenseriformes + [("Family", "Acipenseridae")], ("Genus", "Acipenser"), ("Species", "Acipenser sturio")),
    sp("paddlefish", "Polyodon spathula", _acipenseriformes + [("Family", "Polyodontidae")], ("Genus", "Polyodon"), ("Species", "Polyodon spathula")),
    sp("gar", "Lepisosteus osseus", _lepisosteiformes + [("Family", "Lepisosteidae")], ("Genus", "Lepisosteus"), ("Species", "Lepisosteus osseus")),
    sp("bowfin", "Amia calva", _amiiformes + [("Family", "Amiidae")], ("Genus", "Amia"), ("Species", "Amia calva")),
    sp("bichir", "Polypterus senegalus", _polypteriformes + [("Family", "Polypteridae")], ("Genus", "Polypterus"), ("Species", "Polypterus senegalus")),
    sp("coelacanth", "Latimeria chalumnae", _coelacanthiformes + [("Family", "Latimeriidae")], ("Genus", "Latimeria"), ("Species", "Latimeria chalumnae")),
    sp("lungfish", "Neoceratodus forsteri", _ceratodontiformes + [("Family", "Neoceratodontidae")], ("Genus", "Neoceratodus"), ("Species", "Neoceratodus forsteri")),

    # -- Jawless fish --
    sp("lamprey", "Petromyzon marinus", _petromyzontiformes + [("Family", "Petromyzontidae")], ("Genus", "Petromyzon"), ("Species", "Petromyzon marinus")),
    sp("hagfish", "Myxine glutinosa", _myxiniformes + [("Family", "Myxinidae")], ("Genus", "Myxine"), ("Species", "Myxine glutinosa")),

    # -- Chimera --
    sp("ratfish", "Chimaera monstrosa", _holocephali + [("Order", "Chimaeriformes"), ("Family", "Chimaeridae")], ("Genus", "Chimaera"), ("Species", "Chimaera monstrosa")),

    # ========== INSECTS ==========

    # -- Beetles --
    sp("seven-spot ladybird", "Coccinella septempunctata", _coccinellidae, ("Genus", "Coccinella"), ("Species", "Coccinella septempunctata")),
    sp("stag beetle", "Lucanus cervus", _lucanidae, ("Genus", "Lucanus"), ("Species", "Lucanus cervus")),
    sp("hercules beetle", "Dynastes hercules", _scarabaeidae, ("Genus", "Dynastes"), ("Species", "Dynastes hercules")),
    sp("dung beetle", "Scarabaeus sacer", _scarabaeidae, ("Genus", "Scarabaeus"), ("Species", "Scarabaeus sacer")),
    sp("japanese beetle", "Popillia japonica", _scarabaeidae, ("Genus", "Popillia"), ("Species", "Popillia japonica")),
    sp("firefly", "Photinus pyralis", _lampyridae, ("Genus", "Photinus"), ("Species", "Photinus pyralis")),
    sp("longhorn beetle", "Cerambyx cerdo", _cerambycidae, ("Genus", "Cerambyx"), ("Species", "Cerambyx cerdo")),
    sp("weevil", "Sitophilus granarius", _curculionidae, ("Genus", "Sitophilus"), ("Species", "Sitophilus granarius")),
    sp("colorado potato beetle", "Leptinotarsa decemlineata", _chrysomelidae, ("Genus", "Leptinotarsa"), ("Species", "Leptinotarsa decemlineata")),
    sp("great diving beetle", "Dytiscus marginalis", _dytiscidae, ("Genus", "Dytiscus"), ("Species", "Dytiscus marginalis")),
    sp("deathwatch beetle", "Xestobium rufovillosum", _coleoptera + [("Family", "Ptinidae")], ("Genus", "Xestobium"), ("Species", "Xestobium rufovillosum")),

    # -- Butterflies and moths --
    sp("monarch butterfly", "Danaus plexippus", _nymphalidae, ("Genus", "Danaus"), ("Species", "Danaus plexippus")),
    sp("painted lady", "Vanessa cardui", _nymphalidae, ("Genus", "Vanessa"), ("Species", "Vanessa cardui")),
    sp("red admiral", "Vanessa atalanta", _nymphalidae, ("Genus", "Vanessa"), ("Species", "Vanessa atalanta")),
    sp("peacock butterfly", "Aglais io", _nymphalidae, ("Genus", "Aglais"), ("Species", "Aglais io")),
    sp("swallowtail butterfly", "Papilio machaon", _papilionidae, ("Genus", "Papilio"), ("Species", "Papilio machaon")),
    sp("birdwing butterfly", "Ornithoptera priamus", _papilionidae, ("Genus", "Ornithoptera"), ("Species", "Ornithoptera priamus")),
    sp("cabbage white", "Pieris brassicae", _pieridae, ("Genus", "Pieris"), ("Species", "Pieris brassicae")),
    sp("atlas moth", "Attacus atlas", _saturniidae, ("Genus", "Attacus"), ("Species", "Attacus atlas")),
    sp("luna moth", "Actias luna", _saturniidae, ("Genus", "Actias"), ("Species", "Actias luna")),
    sp("death's-head hawkmoth", "Acherontia atropos", _sphingidae, ("Genus", "Acherontia"), ("Species", "Acherontia atropos")),
    sp("hummingbird hawk-moth", "Macroglossum stellatarum", _sphingidae, ("Genus", "Macroglossum"), ("Species", "Macroglossum stellatarum")),
    sp("silkworm moth", "Bombyx mori", _bombycidae, ("Genus", "Bombyx"), ("Species", "Bombyx mori")),

    # -- Hymenoptera --
    sp("honeybee", "Apis mellifera", _apidae, ("Genus", "Apis"), ("Species", "Apis mellifera")),
    sp("bumblebee", "Bombus terrestris", _apidae, ("Genus", "Bombus"), ("Species", "Bombus terrestris")),
    sp("common wasp", "Vespula vulgaris", _vespidae, ("Genus", "Vespula"), ("Species", "Vespula vulgaris")),
    sp("asian giant hornet", "Vespa mandarinia", _vespidae, ("Genus", "Vespa"), ("Species", "Vespa mandarinia")),
    sp("fire ant", "Solenopsis invicta", _formicidae, ("Genus", "Solenopsis"), ("Species", "Solenopsis invicta")),
    sp("leafcutter ant", "Atta cephalotes", _formicidae, ("Genus", "Atta"), ("Species", "Atta cephalotes")),
    sp("bullet ant", "Paraponera clavata", _formicidae, ("Genus", "Paraponera"), ("Species", "Paraponera clavata")),
    sp("wood ant", "Formica rufa", _formicidae, ("Genus", "Formica"), ("Species", "Formica rufa")),

    # -- Diptera --
    sp("housefly", "Musca domestica", _muscidae, ("Genus", "Musca"), ("Species", "Musca domestica")),
    sp("mosquito", "Aedes aegypti", _culicidae, ("Genus", "Aedes"), ("Species", "Aedes aegypti")),
    sp("fruit fly", "Drosophila melanogaster", _drosophilidae, ("Genus", "Drosophila"), ("Species", "Drosophila melanogaster")),
    sp("tsetse fly", "Glossina morsitans", _diptera + [("Family", "Glossinidae")], ("Genus", "Glossina"), ("Species", "Glossina morsitans")),
    sp("crane fly", "Tipula oleracea", _diptera + [("Family", "Tipulidae")], ("Genus", "Tipula"), ("Species", "Tipula oleracea")),

    # -- Orthoptera --
    sp("desert locust", "Schistocerca gregaria", _orthoptera + [("Family", "Acrididae")], ("Genus", "Schistocerca"), ("Species", "Schistocerca gregaria")),
    sp("grasshopper", "Chorthippus brunneus", _orthoptera + [("Family", "Acrididae")], ("Genus", "Chorthippus"), ("Species", "Chorthippus brunneus")),
    sp("house cricket", "Acheta domesticus", _orthoptera + [("Family", "Gryllidae")], ("Genus", "Acheta"), ("Species", "Acheta domesticus")),
    sp("mole cricket", "Gryllotalpa gryllotalpa", _orthoptera + [("Family", "Gryllotalpidae")], ("Genus", "Gryllotalpa"), ("Species", "Gryllotalpa gryllotalpa")),

    # -- Other insects --
    sp("praying mantis", "Mantis religiosa", _mantodea + [("Family", "Mantidae")], ("Genus", "Mantis"), ("Species", "Mantis religiosa")),
    sp("orchid mantis", "Hymenopus coronatus", _mantodea + [("Family", "Hymenopodidae")], ("Genus", "Hymenopus"), ("Species", "Hymenopus coronatus")),
    sp("german cockroach", "Blattella germanica", _blattodea + [("Family", "Ectobiidae")], ("Genus", "Blattella"), ("Species", "Blattella germanica")),
    sp("madagascar hissing cockroach", "Gromphadorhina portentosa", _blattodea + [("Family", "Blaberidae")], ("Genus", "Gromphadorhina"), ("Species", "Gromphadorhina portentosa")),
    sp("termite", "Reticulitermes flavipes", _blattodea + [("Family", "Rhinotermitidae")], ("Genus", "Reticulitermes"), ("Species", "Reticulitermes flavipes")),
    sp("stick insect", "Carausius morosus", _phasmatodea + [("Family", "Lonchodidae")], ("Genus", "Carausius"), ("Species", "Carausius morosus")),
    sp("dragonfly", "Anax imperator", _odonata + [("Suborder", "Anisoptera"), ("Family", "Aeshnidae")], ("Genus", "Anax"), ("Species", "Anax imperator")),
    sp("damselfly", "Calopteryx virgo", _odonata + [("Suborder", "Zygoptera"), ("Family", "Calopterygidae")], ("Genus", "Calopteryx"), ("Species", "Calopteryx virgo")),
    sp("earwig", "Forficula auricularia", _dermaptera + [("Family", "Forficulidae")], ("Genus", "Forficula"), ("Species", "Forficula auricularia")),
    sp("cicada", "Magicicada septendecim", _hemiptera + [("Family", "Cicadidae")], ("Genus", "Magicicada"), ("Species", "Magicicada septendecim")),
    sp("aphid", "Aphis fabae", _hemiptera + [("Family", "Aphididae")], ("Genus", "Aphis"), ("Species", "Aphis fabae")),
    sp("bed bug", "Cimex lectularius", _hemiptera + [("Family", "Cimicidae")], ("Genus", "Cimex"), ("Species", "Cimex lectularius")),
    sp("water strider", "Gerris lacustris", _hemiptera + [("Family", "Gerridae")], ("Genus", "Gerris"), ("Species", "Gerris lacustris")),
    sp("lacewing", "Chrysoperla carnea", _neuroptera + [("Family", "Chrysopidae")], ("Genus", "Chrysoperla"), ("Species", "Chrysoperla carnea")),
    sp("antlion", "Myrmeleon formicarius", _neuroptera + [("Family", "Myrmeleontidae")], ("Genus", "Myrmeleon"), ("Species", "Myrmeleon formicarius")),
    sp("flea", "Ctenocephalides felis", _siphonaptera + [("Family", "Pulicidae")], ("Genus", "Ctenocephalides"), ("Species", "Ctenocephalides felis")),
    sp("mayfly", "Ephemera danica", _ephemeroptera + [("Family", "Ephemeridae")], ("Genus", "Ephemera"), ("Species", "Ephemera danica")),

    # ========== ARACHNIDS ==========
    sp("mexican red-knee tarantula", "Brachypelma smithi", _theraphosidae, ("Genus", "Brachypelma"), ("Species", "Brachypelma smithi")),
    sp("goliath birdeater", "Theraphosa blondi", _theraphosidae, ("Genus", "Theraphosa"), ("Species", "Theraphosa blondi")),
    sp("black widow", "Latrodectus mactans", _theridiidae, ("Genus", "Latrodectus"), ("Species", "Latrodectus mactans")),
    sp("garden spider", "Araneus diadematus", _araneidae, ("Genus", "Araneus"), ("Species", "Araneus diadematus")),
    sp("golden silk orb-weaver", "Nephila clavipes", _araneidae, ("Genus", "Nephila"), ("Species", "Nephila clavipes")),
    sp("jumping spider", "Salticus scenicus", _salticidae, ("Genus", "Salticus"), ("Species", "Salticus scenicus")),
    sp("brown recluse", "Loxosceles reclusa", _sicariidae, ("Genus", "Loxosceles"), ("Species", "Loxosceles reclusa")),
    sp("emperor scorpion", "Pandinus imperator", _scorpiones + [("Family", "Scorpionidae")], ("Genus", "Pandinus"), ("Species", "Pandinus imperator")),
    sp("deathstalker scorpion", "Leiurus quinquestriatus", _scorpiones + [("Family", "Buthidae")], ("Genus", "Leiurus"), ("Species", "Leiurus quinquestriatus")),
    sp("tick", "Ixodes ricinus", _ixodida + [("Family", "Ixodidae")], ("Genus", "Ixodes"), ("Species", "Ixodes ricinus")),
    sp("harvestman", "Phalangium opilio", _opiliones + [("Family", "Phalangiidae")], ("Genus", "Phalangium"), ("Species", "Phalangium opilio")),
    sp("camel spider", "Galeodes arabs", _solifugae + [("Family", "Galeodidae")], ("Genus", "Galeodes"), ("Species", "Galeodes arabs")),

    # ========== MYRIAPODS ==========
    sp("house centipede", "Scutigera coleoptrata", _chilopoda + [("Order", "Scutigeromorpha"), ("Family", "Scutigeridae")], ("Genus", "Scutigera"), ("Species", "Scutigera coleoptrata")),
    sp("giant centipede", "Scolopendra gigantea", _chilopoda + [("Order", "Scolopendromorpha"), ("Family", "Scolopendridae")], ("Genus", "Scolopendra"), ("Species", "Scolopendra gigantea")),
    sp("giant millipede", "Archispirostreptus gigas", _diplopoda + [("Order", "Spirostreptida"), ("Family", "Spirostreptidae")], ("Genus", "Archispirostreptus"), ("Species", "Archispirostreptus gigas")),
    sp("pill millipede", "Glomeris marginata", _diplopoda + [("Order", "Glomerida"), ("Family", "Glomeridae")], ("Genus", "Glomeris"), ("Species", "Glomeris marginata")),

    # ========== CRUSTACEANS ==========
    sp("american lobster", "Homarus americanus", _decapoda + [("Family", "Nephropidae")], ("Genus", "Homarus"), ("Species", "Homarus americanus")),
    sp("european lobster", "Homarus gammarus", _decapoda + [("Family", "Nephropidae")], ("Genus", "Homarus"), ("Species", "Homarus gammarus")),
    sp("blue crab", "Callinectes sapidus", _decapoda + [("Family", "Portunidae")], ("Genus", "Callinectes"), ("Species", "Callinectes sapidus")),
    sp("japanese spider crab", "Macrocheira kaempferi", _decapoda + [("Family", "Inachidae")], ("Genus", "Macrocheira"), ("Species", "Macrocheira kaempferi")),
    sp("hermit crab", "Pagurus bernhardus", _decapoda + [("Family", "Paguridae")], ("Genus", "Pagurus"), ("Species", "Pagurus bernhardus")),
    sp("king crab", "Paralithodes camtschaticus", _decapoda + [("Family", "Lithodidae")], ("Genus", "Paralithodes"), ("Species", "Paralithodes camtschaticus")),
    sp("crayfish", "Astacus astacus", _decapoda + [("Family", "Astacidae")], ("Genus", "Astacus"), ("Species", "Astacus astacus")),
    sp("prawn", "Penaeus monodon", _decapoda + [("Family", "Penaeidae")], ("Genus", "Penaeus"), ("Species", "Penaeus monodon")),
    sp("mantis shrimp", "Odontodactylus scyllarus", _stomatopoda + [("Family", "Odontodactylidae")], ("Genus", "Odontodactylus"), ("Species", "Odontodactylus scyllarus")),
    sp("woodlouse", "Armadillidium vulgare", _isopoda + [("Family", "Armadillidiidae")], ("Genus", "Armadillidium"), ("Species", "Armadillidium vulgare")),
    sp("krill", "Euphausia superba", _euphausiacea + [("Family", "Euphausiidae")], ("Genus", "Euphausia"), ("Species", "Euphausia superba")),
    sp("barnacle", "Balanus balanoides", _maxillopoda + [("Order", "Sessilia"), ("Family", "Balanidae")], ("Genus", "Balanus"), ("Species", "Balanus balanoides")),
    sp("brine shrimp", "Artemia salina", _branchiopoda + [("Order", "Anostraca"), ("Family", "Artemiidae")], ("Genus", "Artemia"), ("Species", "Artemia salina")),

    # ========== MOLLUSCS ==========

    # -- Cephalopods --
    sp("common octopus", "Octopus vulgaris", _octopoda + [("Family", "Octopodidae")], ("Genus", "Octopus"), ("Species", "Octopus vulgaris")),
    sp("blue-ringed octopus", "Hapalochlaena lunulata", _octopoda + [("Family", "Octopodidae")], ("Genus", "Hapalochlaena"), ("Species", "Hapalochlaena lunulata")),
    sp("giant pacific octopus", "Enteroctopus dofleini", _octopoda + [("Family", "Enteroctopodidae")], ("Genus", "Enteroctopus"), ("Species", "Enteroctopus dofleini")),
    sp("giant squid", "Architeuthis dux", _teuthida + [("Family", "Architeuthidae")], ("Genus", "Architeuthis"), ("Species", "Architeuthis dux")),
    sp("humboldt squid", "Dosidicus gigas", _teuthida + [("Family", "Ommastrephidae")], ("Genus", "Dosidicus"), ("Species", "Dosidicus gigas")),
    sp("common cuttlefish", "Sepia officinalis", _sepiida + [("Family", "Sepiidae")], ("Genus", "Sepia"), ("Species", "Sepia officinalis")),
    sp("nautilus", "Nautilus pompilius", _nautilida + [("Family", "Nautilidae")], ("Genus", "Nautilus"), ("Species", "Nautilus pompilius")),

    # -- Gastropods --
    sp("garden snail", "Cornu aspersum", _gastropoda + [("Order", "Stylommatophora"), ("Family", "Helicidae")], ("Genus", "Cornu"), ("Species", "Cornu aspersum")),
    sp("giant african snail", "Lissachatina fulica", _gastropoda + [("Order", "Stylommatophora"), ("Family", "Achatinidae")], ("Genus", "Lissachatina"), ("Species", "Lissachatina fulica")),
    sp("leopard slug", "Limax maximus", _gastropoda + [("Order", "Stylommatophora"), ("Family", "Limacidae")], ("Genus", "Limax"), ("Species", "Limax maximus")),
    sp("sea slug", "Glaucus atlanticus", _gastropoda + [("Order", "Nudibranchia"), ("Family", "Glaucidae")], ("Genus", "Glaucus"), ("Species", "Glaucus atlanticus")),
    sp("cone snail", "Conus geographus", _gastropoda + [("Order", "Neogastropoda"), ("Family", "Conidae")], ("Genus", "Conus"), ("Species", "Conus geographus")),
    sp("limpet", "Patella vulgata", _gastropoda + [("Order", "Patellogastropoda"), ("Family", "Patellidae")], ("Genus", "Patella"), ("Species", "Patella vulgata")),
    sp("abalone", "Haliotis rufescens", _gastropoda + [("Order", "Lepetellida"), ("Family", "Haliotidae")], ("Genus", "Haliotis"), ("Species", "Haliotis rufescens")),

    # -- Bivalves --
    sp("blue mussel", "Mytilus edulis", _bivalvia + [("Order", "Mytilida"), ("Family", "Mytilidae")], ("Genus", "Mytilus"), ("Species", "Mytilus edulis")),
    sp("pacific oyster", "Crassostrea gigas", _bivalvia + [("Order", "Ostreida"), ("Family", "Ostreidae")], ("Genus", "Crassostrea"), ("Species", "Crassostrea gigas")),
    sp("giant clam", "Tridacna gigas", _bivalvia + [("Order", "Cardiida"), ("Family", "Cardiidae")], ("Genus", "Tridacna"), ("Species", "Tridacna gigas")),
    sp("scallop", "Pecten maximus", _bivalvia + [("Order", "Pectinida"), ("Family", "Pectinidae")], ("Genus", "Pecten"), ("Species", "Pecten maximus")),
    sp("razor clam", "Ensis siliqua", _bivalvia + [("Order", "Adapedonta"), ("Family", "Pharidae")], ("Genus", "Ensis"), ("Species", "Ensis siliqua")),

    # ========== CNIDARIANS ==========
    sp("moon jellyfish", "Aurelia aurita", _scyphozoa + [("Order", "Semaeostomeae"), ("Family", "Ulmaridae")], ("Genus", "Aurelia"), ("Species", "Aurelia aurita")),
    sp("lions mane jellyfish", "Cyanea capillata", _scyphozoa + [("Order", "Semaeostomeae"), ("Family", "Cyaneidae")], ("Genus", "Cyanea"), ("Species", "Cyanea capillata")),
    sp("box jellyfish", "Chironex fleckeri", _cubozoa + [("Order", "Chirodropida"), ("Family", "Chirodropidae")], ("Genus", "Chironex"), ("Species", "Chironex fleckeri")),
    sp("staghorn coral", "Acropora cervicornis", _anthozoa + [("Order", "Scleractinia"), ("Family", "Acroporidae")], ("Genus", "Acropora"), ("Species", "Acropora cervicornis")),
    sp("sea anemone", "Actinia equina", _anthozoa + [("Order", "Actiniaria"), ("Family", "Actiniidae")], ("Genus", "Actinia"), ("Species", "Actinia equina")),
    sp("portuguese man o war", "Physalia physalis", _hydrozoa + [("Order", "Siphonophorae"), ("Family", "Physaliidae")], ("Genus", "Physalia"), ("Species", "Physalia physalis")),
    sp("hydra", "Hydra vulgaris", _hydrozoa + [("Order", "Anthoathecata"), ("Family", "Hydridae")], ("Genus", "Hydra"), ("Species", "Hydra vulgaris")),

    # ========== ECHINODERMS ==========
    sp("common starfish", "Asterias rubens", _asteroidea + [("Order", "Forcipulatida"), ("Family", "Asteriidae")], ("Genus", "Asterias"), ("Species", "Asterias rubens")),
    sp("crown-of-thorns starfish", "Acanthaster planci", _asteroidea + [("Order", "Valvatida"), ("Family", "Acanthasteridae")], ("Genus", "Acanthaster"), ("Species", "Acanthaster planci")),
    sp("sea urchin", "Echinus esculentus", _echinoidea + [("Order", "Camarodonta"), ("Family", "Echinidae")], ("Genus", "Echinus"), ("Species", "Echinus esculentus")),
    sp("sand dollar", "Echinarachnius parma", _echinoidea + [("Order", "Clypeasteroida"), ("Family", "Echinarachniidae")], ("Genus", "Echinarachnius"), ("Species", "Echinarachnius parma")),
    sp("sea cucumber", "Holothuria forskali", _holothuroidea + [("Order", "Holothuriida"), ("Family", "Holothuriidae")], ("Genus", "Holothuria"), ("Species", "Holothuria forskali")),
    sp("brittle star", "Ophiothrix fragilis", _ophiuroidea + [("Order", "Ophiurida"), ("Family", "Ophiotrichidae")], ("Genus", "Ophiothrix"), ("Species", "Ophiothrix fragilis")),
    sp("sea lily", "Antedon bifida", _crinoidea + [("Order", "Comatulida"), ("Family", "Antedonidae")], ("Genus", "Antedon"), ("Species", "Antedon bifida")),

    # ========== WORMS ==========
    sp("earthworm", "Lumbricus terrestris", _annelida + [("Class", "Clitellata"), ("Order", "Opisthopora"), ("Family", "Lumbricidae")], ("Genus", "Lumbricus"), ("Species", "Lumbricus terrestris")),
    sp("medicinal leech", "Hirudo medicinalis", _annelida + [("Class", "Clitellata"), ("Order", "Hirudinida"), ("Family", "Hirudinidae")], ("Genus", "Hirudo"), ("Species", "Hirudo medicinalis")),
    sp("ragworm", "Nereis virens", _annelida + [("Class", "Polychaeta"), ("Order", "Phyllodocida"), ("Family", "Nereididae")], ("Genus", "Nereis"), ("Species", "Nereis virens")),
    sp("christmas tree worm", "Spirobranchus giganteus", _annelida + [("Class", "Polychaeta"), ("Order", "Sabellida"), ("Family", "Serpulidae")], ("Genus", "Spirobranchus"), ("Species", "Spirobranchus giganteus")),
    sp("roundworm", "Ascaris lumbricoides", _nematoda + [("Class", "Chromadorea"), ("Order", "Ascaridida"), ("Family", "Ascarididae")], ("Genus", "Ascaris"), ("Species", "Ascaris lumbricoides")),
    sp("tapeworm", "Taenia solium", _platyhelminthes + [("Class", "Cestoda"), ("Order", "Cyclophyllidea"), ("Family", "Taeniidae")], ("Genus", "Taenia"), ("Species", "Taenia solium")),
    sp("planarian", "Dugesia tigrina", _platyhelminthes + [("Class", "Turbellaria"), ("Order", "Tricladida"), ("Family", "Dugesiidae")], ("Genus", "Dugesia"), ("Species", "Dugesia tigrina")),

    # ========== OTHER INVERTEBRATES ==========
    sp("sea sponge", "Spongia officinalis", _porifera + [("Class", "Demospongiae"), ("Order", "Dictyoceratida"), ("Family", "Spongiidae")], ("Genus", "Spongia"), ("Species", "Spongia officinalis")),
    sp("tardigrade", "Hypsibius dujardini", _tardigrada + [("Class", "Eutardigrada"), ("Order", "Parachela"), ("Family", "Hypsibiidae")], ("Genus", "Hypsibius"), ("Species", "Hypsibius dujardini")),
]


def main():
    # Validate
    valid = []
    for animal in SPECIES:
        ranks = [e["rank"] for e in animal["lineage"]]
        if "Kingdom" not in ranks:
            print(f"WARNING: {animal['common_name']} missing Kingdom")
            continue
        if "Species" not in ranks:
            print(f"WARNING: {animal['common_name']} missing Species")
            continue
        valid.append(animal)

    # Sort
    valid.sort(key=lambda a: a["common_name"].lower())

    # Deduplicate
    seen = set()
    deduped = []
    for a in valid:
        key = a["common_name"].lower()
        if key in seen:
            print(f"DEDUP: {a['common_name']}")
        else:
            seen.add(key)
            deduped.append(a)

    # Stats
    ranks_used = set()
    phyla = set()
    classes = set()
    orders = set()
    families = set()
    for a in deduped:
        for e in a["lineage"]:
            ranks_used.add(e["rank"])
            if e["rank"] == "Phylum": phyla.add(e["name"])
            elif e["rank"] == "Class": classes.add(e["name"])
            elif e["rank"] == "Order": orders.add(e["name"])
            elif e["rank"] == "Family": families.add(e["name"])

    dataset = {
        "metadata": {
            "version": "1.0",
            "total_species": len(deduped),
            "taxonomy_source": "NCBI-style (curated)",
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "stats": {
                "ranks_used": sorted(ranks_used),
                "phyla_count": len(phyla),
                "class_count": len(classes),
                "order_count": len(orders),
                "family_count": len(families),
            }
        },
        "species": deduped,
    }

    OUTPUT_FILE.write_text(json.dumps(dataset, indent=2, ensure_ascii=False))
    print(f"Wrote {len(deduped)} species to {OUTPUT_FILE}")
    print(f"Phyla ({len(phyla)}): {sorted(phyla)}")
    print(f"Classes ({len(classes)}): {sorted(classes)}")
    print(f"Orders ({len(orders)})")
    print(f"Families ({len(families)})")
    print(f"Ranks: {sorted(ranks_used)}")


if __name__ == "__main__":
    main()
