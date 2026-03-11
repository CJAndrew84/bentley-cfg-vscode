import * as vscode from 'vscode';

// ─────────────────────────────────────────────────────────────────────────────
// Variable knowledge base
// ─────────────────────────────────────────────────────────────────────────────

interface CfgVariable {
  name: string;
  documentation: string;
  category: 'ustn' | 'ms' | 'civil' | 'user';
  valueHint?: string;
  example?: string;
}

const CFG_VARIABLES: CfgVariable[] = [
  // _USTN system variables
  { name: '_USTN_WORKSPACEROOT', category: 'ustn', documentation: 'Root directory for the current WorkSpace. All WorkSpace-level data is relative to this path.', example: '_USTN_WORKSPACEROOT = W:/Bentley/WorkSpaces/MyClient/' },
  { name: '_USTN_WORKSPACESTANDARDS', category: 'ustn', documentation: 'Directory containing WorkSpace-level standards (cells, dgnlibs, seeds, etc.).', example: '_USTN_WORKSPACESTANDARDS = $(_USTN_WORKSPACEROOT)Standards/' },
  { name: '_USTN_WORKSETSROOT', category: 'ustn', documentation: 'Root directory containing all WorkSet folders for this WorkSpace.', example: '_USTN_WORKSETSROOT = $(_USTN_WORKSPACEROOT)WorkSets/' },
  { name: '_USTN_WORKSPACENAME', category: 'ustn', documentation: 'The name of the currently active WorkSpace (set by MicroStation, not in CFG files).', valueHint: 'Read-only - set by MicroStation' },
  { name: '_USTN_WORKSPACECFG', category: 'ustn', documentation: 'Path to the currently active WorkSpace CFG file.', valueHint: 'Read-only - computed by msconfig.cfg' },
  { name: '_USTN_WORKSETROOT', category: 'ustn', documentation: 'Root directory for the current WorkSet (project).', example: '# Redirect: _USTN_WORKSETROOT = P:/Projects/$(_USTN_WORKSETNAME)/' },
  { name: '_USTN_WORKSETSTANDARDS', category: 'ustn', documentation: 'Directory containing WorkSet-level standards.', example: '_USTN_WORKSETSTANDARDS = $(_USTN_WORKSETROOT)Standards/' },
  { name: '_USTN_WORKSETDATA', category: 'ustn', documentation: 'Directory containing WorkSet DGN, DWG, and other design data files.', example: '_USTN_WORKSETDATA = $(_USTN_WORKSETROOT)dgn/' },
  { name: '_USTN_WORKSETNAME', category: 'ustn', documentation: 'The name of the currently active WorkSet (set by MicroStation).', valueHint: 'Read-only - set by MicroStation' },
  { name: '_USTN_WORKSPACESROOT', category: 'ustn', documentation: 'Root directory containing all WorkSpace folders. Defined in WorkSpaceSetup.cfg.', example: '_USTN_WORKSPACESROOT = W:/Bentley/Configuration/WorkSpaces/' },
  { name: '_USTN_CONFIGURATION', category: 'ustn', documentation: 'Root of the Bentley configuration directory (contains WorkSpaces, Organization, etc.).', valueHint: 'Usually set in ConfigurationSetup.cfg' },
  { name: '_USTN_CUSTOM_CONFIGURATION', category: 'ustn', documentation: 'Path to a custom configuration directory that overrides the default Bentley configuration.', example: '_USTN_CUSTOM_CONFIGURATION = W:/Bentley/CONNECTEdition/Configuration/' },
  { name: '_USTN_ORGANIZATION', category: 'ustn', documentation: 'Root directory for organization-wide standards. Default: $(_USTN_CONFIGURATION)Organization/', example: '_USTN_ORGANIZATION = W:/Bentley/Configuration/Organization/' },
  { name: '_USTN_ROLECFG', category: 'ustn', documentation: 'Path to the role-level configuration file. When defined, this file is processed after WorkSpace/WorkSet files.', example: '_USTN_ROLECFG = $(_USTN_WORKSPACEROOT)Roles/$(_USTN_ROLENAME).cfg' },
  { name: '_USTN_ROLENAME', category: 'ustn', documentation: 'Name of the current user role.', valueHint: 'Set externally or in user config' },
  { name: '_USTN_WORKSPACELABEL', category: 'ustn', documentation: 'Display label used in the MicroStation UI instead of "WorkSpace". E.g., "Client" or "Department".', example: '_USTN_WORKSPACELABEL : Client' },
  { name: '_USTN_WORKSETLABEL', category: 'ustn', documentation: 'Display label used in the MicroStation UI instead of "WorkSet". E.g., "Project".', example: '_USTN_WORKSETLABEL : Project' },
  { name: '_USTN_DISPLAYALLCFGVARS', category: 'ustn', documentation: 'When set to 1, displays all configuration variables (including hidden _USTN_ vars) in the Config Variables dialog. Useful for debugging.', example: '_USTN_DISPLAYALLCFGVARS = 1', valueHint: '0 or 1' },
  { name: '_USTN_CAPABILITY', category: 'ustn', documentation: 'Controls user capability flags. Use + to enable, - to disable capabilities.', example: '_USTN_CAPABILITY > -CAPABILITY_LEVELS_CREATE' },
  { name: '_USTN_USERNAME', category: 'ustn', documentation: 'The current Windows username.', example: '_USTN_USERNAME = $(USERNAME)' },

  // MS_ variables
  { name: 'MS_DESIGNSEED', category: 'ms', documentation: 'Path to the default seed DGN file used when creating new design files. Must be a specific file path.', example: 'MS_DESIGNSEED = $(_USTN_WORKSETSTANDARDS)Seed/seed3d.dgn' },
  { name: 'MS_RFDIR', category: 'ms', documentation: 'Search path(s) for reference files. Use > to append or < to prepend additional directories. Semicolon-separated.', example: 'MS_RFDIR > $(_USTN_WORKSETROOT)References/' },
  { name: 'MS_CELLLIST', category: 'ms', documentation: 'Search path(s) for cell libraries (.cel files). Use > to append directories.', example: 'MS_CELLLIST > $(_USTN_WORKSPACESTANDARDS)Cell/' },
  { name: 'MS_CELL_SEEDFILE', category: 'ms', documentation: 'Seed file used when creating a new cell library.', example: 'MS_CELL_SEEDFILE = $(_USTN_WORKSPACESTANDARDS)Cell/cellseed.dgn' },
  { name: 'MS_DGNLIB', category: 'ms', documentation: 'Search path(s) for DGN library files (.dgnlib). Used for shared levels, styles, etc.', example: 'MS_DGNLIB > $(_USTN_WORKSPACESTANDARDS)Dgnlib/' },
  { name: 'MS_DGNLIBLIST', category: 'ms', documentation: 'Specific list of DGN library files to load (as opposed to MS_DGNLIB which is a search directory).', example: 'MS_DGNLIBLIST > $(_USTN_WORKSPACESTANDARDS)Dgnlib/levels.dgnlib' },
  { name: 'MS_DGNLIBLIST_DRAWINGSEEDS', category: 'ms', documentation: 'Extended DGNLib list specifically for drawing seeds. Bentley notes this variable must also be represented in `MS_DGNLIBLIST`, and an initial `=` assignment can be used to cancel delivered out-of-box seed definitions before appending custom ones.', example: 'MS_DGNLIBLIST > $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/Sheet Seeds/*.dgnlib\nMS_DGNLIBLIST_DRAWINGSEEDS = $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/Sheet Seeds/*.dgnlib\nMS_DGNLIBLIST_DRAWINGSEEDS > $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/Sheet Seeds/Details/*.dgnlib' },
  { name: 'MS_DGNLIBLIST_DISPLAYSTYLES', category: 'ms', documentation: 'Extended DGNLib list specifically for display styles. Once an extended `MS_DGNLIBLIST_*` variable is defined, MicroStation stops reading that category from the base `MS_DGNLIBLIST`, so use the extension consistently across the workspace.', example: 'MS_DGNLIBLIST_DISPLAYSTYLES = $(_USTN_SYSTEMROOT)Dgnlib/DrawComp/en/*.dgnlib\nMS_DGNLIBLIST_DISPLAYSTYLES < $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/Display Styles/*.dgnlib' },
  { name: 'MS_DGNLIBLIST_ELEMENTTEMPLATES', category: 'ms', documentation: 'Extended DGNLib list specifically for element templates. Prefer this over a generic `MS_DGNLIBLIST` entry when you want element-template-only definitions.', example: 'MS_DGNLIBLIST_ELEMENTTEMPLATES > $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/Element Templates/*.dgnlib' },
  { name: 'MS_DGNLIBLIST_ITEMTYPES', category: 'ms', documentation: 'Extended DGNLib list specifically for Item Types definitions.', example: 'MS_DGNLIBLIST_ITEMTYPES > $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/Item Types/*.dgnlib' },
  { name: 'MS_DGNLIBLIST_PRINTING', category: 'ms', documentation: 'Extended DGNLib list specifically for printing definitions such as print styles.', example: 'MS_DGNLIBLIST_PRINTING > $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/Printing/Print_Styles.dgnlib' },
  { name: 'MS_SYSTEMDGNLIBLIST', category: 'ms', documentation: 'System-level DGN library list (higher priority than MS_DGNLIBLIST).', valueHint: 'Path to .dgnlib file' },
  { name: 'MS_PLOTFILES', category: 'ms', documentation: 'Default output directory for plot/print files.', example: 'MS_PLOTFILES = $(_USTN_WORKSETROOT)Output/Plots/' },
  { name: 'MS_PLTFILES', category: 'ms', documentation: 'Plot file output directory used by MicroStation print workflows. Bentley examples often point this to `$(MS_BACKUP)`.', example: 'MS_PLTFILES = $(MS_BACKUP)' },
  { name: 'MS_PLTCFG', category: 'ms', documentation: 'Search path for printer driver (.pltcfg) files.', example: 'MS_PLTCFG > $(_USTN_WORKSPACESTANDARDS)Plot/' },
  { name: 'MS_PLTCFG_PATH', category: 'ms', documentation: 'Search path for print configuration (`.pltcfg`) files. Commonly used in current ORD workspace examples.', example: 'MS_PLTCFG_PATH = $(CIVIL_ORGANIZATION_STANDARDS)Printing/Plot_Config/' },
  { name: 'MS_LINESTYLE', category: 'ms', documentation: 'Search path(s) for custom line style resource files.', example: 'MS_LINESTYLE > $(_USTN_WORKSPACESTANDARDS)Linestyle/' },
  { name: 'MS_MDLAPPS', category: 'ms', documentation: 'Search path(s) for MDL applications to load.', example: 'MS_MDLAPPS > $(_USTN_WORKSPACEROOT)Mdlapps/' },
  { name: 'MS_MACROS', category: 'ms', documentation: 'Search path(s) for VBA macro files.', example: 'MS_MACROS > $(_USTN_WORKSPACEROOT)Macros/' },
  { name: 'MS_VBASEARCHDIRECTORIES', category: 'ms', documentation: 'ProjectWise VBA search directories. Bentley recommends defining this so ProjectWise copies out the extra files a macro needs.', example: 'MS_VBASEARCHDIRECTORIES > $(CIVIL_ORGANIZATION_STANDARDS)Macros/' },
  { name: 'MS_VBACOPYOUT', category: 'ms', documentation: 'ProjectWise copy-out list for VBA-related content. Often set equal to `$(MS_VBASEARCHDIRECTORIES)` and extended for report macro folders.', example: 'MS_VBACOPYOUT = $(MS_VBASEARCHDIRECTORIES)' },
  { name: 'MS_PATTERN', category: 'ms', documentation: 'Search path for area pattern cell libraries.', example: 'MS_PATTERN > $(_USTN_WORKSPACESTANDARDS)Pattern/' },
  { name: 'MS_DEF', category: 'ms', documentation: 'Default directory for design files shown in File Open dialog.', example: 'MS_DEF = $(_USTN_WORKSETDATA)' },
  { name: 'MS_GUIDATA', category: 'ms', documentation: 'Search path for GUI customization data (toolboxes, tool settings, etc.).', example: 'MS_GUIDATA > $(_USTN_WORKSPACEROOT)Guidata/' },
  { name: 'MS_SYMBRSRC', category: 'ms', documentation: 'Symbolism resource files search path.', valueHint: 'Path to .rsc file' },
  { name: 'MS_DWGSEED', category: 'ms', documentation: 'Path to seed DWG file used when creating new DWG files.', example: 'MS_DWGSEED = $(_USTN_WORKSETSTANDARDS)Seed/seed.dwg' },
  { name: 'MS_DWGDATA', category: 'ms', documentation: 'Configuration data for DWG file handling.', valueHint: 'Path to DWG data directory' },
  { name: 'MS_BACKUP', category: 'ms', documentation: 'Directory for automatic backup files.', example: 'MS_BACKUP = $(_USTN_WORKSETROOT)Backup/' },
  { name: 'MS_FILEHISTORY', category: 'ms', documentation: 'Controls whether documents opened from ProjectWise Explorer are added to the MicroStation MRU (most recently used) file list. In integrated MicroStation, commented out behaves like 1.', valueHint: '0 or 1' },
  { name: 'MS_PRINT', category: 'ms', documentation: 'Search path for print/plot configuration.', example: 'MS_PRINT > $(_USTN_WORKSPACESTANDARDS)Print/' },
  { name: 'MS_PRINT_ORGANIZER', category: 'ms', documentation: 'Search path for Print Organizer print set (.pset) files.', example: 'MS_PRINT_ORGANIZER > $(_USTN_WORKSPACESTANDARDS)PrintOrganizer/' },
  { name: 'MS_IPLOT', category: 'ms', documentation: 'iPlot configuration search path.', valueHint: 'Path to iPlot config directory' },
  { name: 'MS_RENDERDATA', category: 'ms', documentation: 'Search path for rendering materials and data.', example: 'MS_RENDERDATA > $(_USTN_WORKSPACESTANDARDS)Renderdata/' },
  { name: 'MS_TASKNAVIGATORCFG', category: 'ms', documentation: 'Path to task navigator configuration XML file.', example: 'MS_TASKNAVIGATORCFG = $(_USTN_WORKSPACESTANDARDS)Xml/TaskNav.xml' },
  { name: 'MS_PDFEXPORT', category: 'ms', documentation: 'Search path for PDF export configuration.', example: 'MS_PDFEXPORT > $(_USTN_WORKSPACESTANDARDS)PdfExport/' },
  { name: 'MS_PROTECTION_ENCRYPT', category: 'ms', documentation: 'Controls file encryption on save. 0=none, 1=encrypt. Use %lock to prevent override.', valueHint: '0 or 1', example: 'MS_PROTECTION_ENCRYPT = 0\n%lock MS_PROTECTION_ENCRYPT' },
  { name: 'MS_DESIGN_HISTORY', category: 'ms', documentation: 'Controls design history tracking. Semicolon-separated key=value pairs.', example: 'MS_DESIGN_HISTORY = create=0;delete=0;commit=0;browse=0' },
  { name: 'MS_EXPANDLEVELNAMES', category: 'ms', documentation: 'Controls how level names are expanded/displayed.', valueHint: '0 or 1' },
  { name: 'MS_LEVEL_DISPLAY_FORMAT', category: 'ms', documentation: 'Controls how level names and descriptions are displayed in UI prompts. Bentley highlights `N (D)` to show level descriptions while hovering over elements.', example: 'MS_LEVEL_DISPLAY_FORMAT = N (D)' },
  { name: 'MS_KEYIN', category: 'ms', documentation: 'Search path for key-in definition files.', example: 'MS_KEYIN > $(_USTN_WORKSPACEROOT)Data/' },
  { name: 'MS_OUTPUT', category: 'ms', documentation: 'Default output directory for exports.', example: 'MS_OUTPUT = $(_USTN_WORKSETROOT)Output/' },
  { name: 'MS_MATERIAL', category: 'ms', documentation: 'Search path for rendering material (.mat) files.', example: 'MS_MATERIAL > $(_USTN_WORKSPACESTANDARDS)Material/' },
  { name: 'MS_LOCAL_MATERIALS', category: 'ms', documentation: 'If set to `1`, materials are localized on use and DGN files default to a local materials table when needed. Bentley recommends this for better iTwin and iModel material support.', valueHint: '0 or 1', example: 'MS_LOCAL_MATERIALS = 1' },
  { name: 'MS_PENTABLE', category: 'ms', documentation: 'Search path for print pen tables.', example: 'MS_PENTABLE = $(CIVIL_ORGANIZATION_STANDARDS)Printing/Pen Tables/' },
  { name: 'MS_DEFAULT_PLTCFG_FILE', category: 'ms', documentation: 'Default print configuration file name used by MicroStation printing.', example: 'MS_DEFAULT_PLTCFG_FILE = xDOT_Standard_PDF.pltcfg' },
  { name: 'MS_PLT_PDF_PLTFILE', category: 'ms', documentation: 'Default PDF print configuration file for PDF plotting workflows.', example: 'MS_PLT_PDF_PLTFILE = xDOT_Standard_PDF.pltcfg' },
  { name: 'MS_PLT_MAX_WORKER_TASKS', category: 'ms', documentation: 'Hidden plotting performance variable controlling how many tasks the non-graphics print worker processes before restarting itself. Bentley recommends larger values such as `2000` for large batch print jobs.', valueHint: 'Positive integer', example: 'MS_PLT_MAX_WORKER_TASKS = 2000' },
  { name: 'MS_PLT_AUTOAREA_RESULT_LIMIT', category: 'ms', documentation: 'Maximum number of auto-area results returned by plotting workflows.', valueHint: 'Positive integer', example: 'MS_PLT_AUTOAREA_RESULT_LIMIT = 2000' },
  { name: 'MS_PLT_ENABLE_AUTO_ROTATE', category: 'ms', documentation: 'Enables print auto-rotation.', valueHint: '0 or 1', example: 'MS_PLT_ENABLE_AUTO_ROTATE = 1' },
  { name: 'MS_PLT_MAX_ON_NEW_AREA', category: 'ms', documentation: 'Controls how many attempts are made when finding a new plot area.', valueHint: 'Positive integer', example: 'MS_PLT_MAX_ON_NEW_AREA = 1' },
  { name: 'MS_PLT_ENABLE_VARIABLE_DEFINITION_MODE', category: 'ms', documentation: 'Controls variable definition mode in plotting.', valueHint: '0 or 1', example: 'MS_PLT_ENABLE_VARIABLE_DEFINITION_MODE = 0' },
  { name: 'MS_PLTDLG_CLOSE_AFTER_PLOT', category: 'ms', documentation: 'Closes the print dialog after plotting completes.', valueHint: '0 or 1', example: 'MS_PLTDLG_CLOSE_AFTER_PLOT = 1' },
  { name: 'MS_PLTDLG_ENABLE_SAVE_CONFIG', category: 'ms', documentation: 'Enables saving print dialog configuration.', valueHint: '0 or 1', example: 'MS_PLTDLG_ENABLE_SAVE_CONFIG = 1' },
  { name: 'MS_PLTDLG_SET_UNITS_FROM_SHEET', category: 'ms', documentation: 'Sets print units from the active sheet model.', valueHint: '0 or 1', example: 'MS_PLTDLG_SET_UNITS_FROM_SHEET = 1' },
  { name: 'MS_PLTDLG_SHOW_PRINT_STATUS', category: 'ms', documentation: 'Displays print status while plotting.', valueHint: '0 or 1', example: 'MS_PLTDLG_SHOW_PRINT_STATUS = 1' },
  { name: 'MS_PRINTERLIST_SYSPRINTERS', category: 'ms', documentation: 'Controls whether system printers are shown in the printer list.', valueHint: '0 or 1', example: 'MS_PRINTERLIST_SYSPRINTERS = 0' },
  { name: 'MS_PLOTDLG_DEF_PENTABLE', category: 'ms', documentation: 'Default pen table shown in the plot dialog.', example: 'MS_PLOTDLG_DEF_PENTABLE = Black.tbl' },
  { name: 'MS_OPENV7', category: 'ms', documentation: 'Controls how V7 files are opened; Bentley print examples often set this to `3`.', valueHint: 'Integer', example: 'MS_OPENV7 = 3' },
  { name: 'MS_PLT_UPDATE_FIELDS', category: 'ms', documentation: 'Controls field updates during print output.', valueHint: 'Integer', example: 'MS_PLT_UPDATE_FIELDS = 2' },
  { name: 'MS_DESIGNMODELSEED', category: 'ms', documentation: 'Model name used within the design seed file when creating new files.', example: 'MS_DESIGNMODELSEED = Default' },
  { name: 'MS_SHEETMODELSEEDNAME', category: 'ms', documentation: 'Sheet model name to use within the sheet-model-only DGNLib seed file. Bentley notes that the spelling must match an actual model name in the DGNLib.', example: 'MS_SHEETMODELSEEDNAME = SheetModel' },
  { name: 'MS_IDLETIMEOUT', category: 'ms', documentation: 'Number of idle minutes before the product exits automatically. Bentley suggests `120` to reduce unused product time charges; minimum is 30, `0` means never exit.', valueHint: '0 or integer >= 30', example: 'MS_IDLETIMEOUT = 120' },
  { name: 'MS_FONTCONFIGFILE', category: 'ms', documentation: 'Path to a custom font configuration XML file used to hide non-standard fonts from font pickers while keeping legacy compatibility.', example: 'MS_FONTCONFIGFILE = $(CIVIL_ORGANIZATION_STANDARDS)Fonts/FontConfig.xml' },
  { name: 'MS_CURSORPROMPT', category: 'ms', documentation: 'Controls cursor prompt display. Bentley explicitly warns not to use `MS_CURSORPROMPT = 1` prior to 2025 products.', valueHint: 'Version-sensitive integer', example: '# Do not use prior to 2025\nMS_CURSORPROMPT = 1' },
  { name: 'MS_SPLINES', category: 'ms', documentation: 'Configuration for spline/curve behavior.', valueHint: 'Path or setting value' },

  // Civil/ORD variables
  { name: 'CIVIL_ROADWAY_TEMPLATE_LIBRARY', category: 'civil', documentation: 'Full path to the road template library (.itl) file for OpenRoads Designer.', example: 'CIVIL_ROADWAY_TEMPLATE_LIBRARY = $(APP_STANDARDS)Template Library/$(_USTN_WORKSPACENAME).itl' },
  { name: 'CIVIL_WORKSPACE_TEMPLATE_LIBRARY_NAME', category: 'civil', documentation: 'Filename of the workspace-level template library. Used to construct CIVIL_ROADWAY_TEMPLATE_LIBRARY.', example: 'CIVIL_WORKSPACE_TEMPLATE_LIBRARY_NAME = MyClient.itl' },
  { name: 'CIVIL_WORKSPACE_DESIGNSEED', category: 'civil', documentation: 'Filename of the civil design seed to use (resolved against APP_STANDARDS/Seed/).', example: 'CIVIL_WORKSPACE_DESIGNSEED = design_seed3d_road.dgn' },
  { name: 'APP_STANDARDS', category: 'civil', documentation: 'Path to the active application standards directory (OpenRoads Designer specific).', valueHint: 'Read-only - set by ORD application' },
  { name: 'CIVIL_FEATUREDEF', category: 'civil', documentation: 'Search path for civil feature definition XML files.', example: 'CIVIL_FEATUREDEF > $(APP_STANDARDS)Feature Definitions/' },
  { name: 'CIVIL_CORRIDORDEF', category: 'civil', documentation: 'Search path for civil corridor definition files.', valueHint: 'Path to corridor definitions' },
  { name: 'CIVIL_ORGANIZATION', category: 'civil', documentation: 'Organization-level civil standards path.', example: 'CIVIL_ORGANIZATION = $(_USTN_ORGANIZATION)Civil/' },
  { name: 'CIVIL_DEFAULT_STATION_LOCK', category: 'civil', documentation: 'Controls the default station lock state. Bentley notes this should be set to `1`, not `True`.', valueHint: '0 or 1', example: 'CIVIL_DEFAULT_STATION_LOCK = 1' },
  { name: 'CIVIL_SURVEY_RETAIN_SURVEY_ON_COPY', category: 'civil', documentation: 'Obsolete variable. Bentley states it has been abandoned in the code and should be removed if found.', valueHint: 'Deprecated / do not use' },
  { name: 'CIVIL_SUPERELEVATION_RULE_FILE', category: 'civil', documentation: 'Full path and filename of the superelevation rule file. Bentley notes that both the directory path and file name must be included.', example: 'CIVIL_SUPERELEVATION_RULE_FILE = $(CIVIL_ORGANIZATION_STANDARDS)Superelevation/Rules/MyRules.xml' },
  { name: 'CIVILPROPERTYECEXPRESSION', category: 'civil', documentation: 'For 2022 R1 and later, enables Copy ECExpressions functionality from Explorer Properties fields.', valueHint: '0 or 1', example: 'CIVILPROPERTYECEXPRESSION = 1' },
  { name: 'CIVIL_TOOL_SETTINGS_OMIT_ITEMTYPES', category: 'civil', documentation: 'Hides Item Types from Tool Settings dialogs while leaving them in the MicroStation Properties dialog.', valueHint: 'True or False', example: 'CIVIL_TOOL_SETTINGS_OMIT_ITEMTYPES = True' },
  { name: 'CIVIL_QUICK_PROPERTIES_OMIT_ITEMTYPES', category: 'civil', documentation: 'Hides Item Types from Quick Properties dialogs while leaving them in the MicroStation Properties dialog.', valueHint: 'True or False', example: 'CIVIL_QUICK_PROPERTIES_OMIT_ITEMTYPES = True' },
  { name: 'CIVIL_CONTENTMANAGEMENTDGNLIBLIST', category: 'civil', documentation: 'For 10.12+ products, points to the DGNLib containing Civil Labeler definitions. Bentley notes this replaces older XML-based Civil Labeler configuration.', example: 'CIVIL_CONTENTMANAGEMENTDGNLIBLIST = $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/Labeler/Civil_Labeler.dgnlib' },
  { name: 'CIVIL_REPORTS_SUBDIRECTORIES', category: 'civil', documentation: 'Ordered list of report subdirectories. Bentley highlights careful use of `=`, `>`, and `<`, plus whether a trailing slash is required, when combining delivered and custom report folders.', example: 'CIVIL_REPORTS_SUBDIRECTORIES = $(_ROOTDIR)Default/Reports/Cant\nCIVIL_REPORTS_SUBDIRECTORIES > $(_ROOTDIR)Default/Reports/CivilGeometry\nCIVIL_REPORTS_SUBDIRECTORIES < $(CIVIL_ORGANIZATION_STANDARDS)Reports/Custom/' },
  { name: 'CIVIL_REPORTS_RESOURCES', category: 'civil', documentation: 'Path list for report resource content used by custom reports.', example: 'CIVIL_REPORTS_RESOURCES < $(CIVIL_ORGANIZATION_STANDARDS)Iowa_Reports/' },
  { name: 'CIVIL_SURVEY_STROKE_TOLERANCE_LINEAR', category: 'civil', documentation: 'Linear stroke tolerance for survey triangulation. Bentley notes large values such as `10000` avoid adding intermediate shots along breaklines.', valueHint: 'Numeric', example: 'CIVIL_SURVEY_STROKE_TOLERANCE_LINEAR = 10000' },
  { name: 'CIVIL_SURVEY_STROKE_TOLERANCE_CURVE', category: 'civil', documentation: 'Curve stroke tolerance for survey triangulation. For ORD 2024+, Bentley suggests `0` when you do not want additional triangles along arcs.', valueHint: 'Numeric', example: 'CIVIL_SURVEY_STROKE_TOLERANCE_CURVE = 0' },
  { name: 'CIVIL_ENABLE_QUICK_PRINTSERVER', category: 'civil', documentation: 'Makes ORD use a lighter-weight non-graphics print server process for faster printing.', valueHint: '0 or 1', example: 'CIVIL_ENABLE_QUICK_PRINTSERVER = 1' },
  { name: 'CIVIL_SUBSURFACE_FILTERS_DGNLIBLIST', category: 'civil', documentation: 'Path and file name of the DGNLib containing drainage/utilities subsurface filters.', example: 'CIVIL_SUBSURFACE_FILTERS_DGNLIBLIST = $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/xDOT_Drainage and Utilities Features Annotations Imperial.dgnlib' },
  { name: 'CIVIL_CROSSSECTION_STACK_TOP_DOWN', category: 'civil', documentation: 'When `TRUE`, cross sections are created from the top to the bottom of the sheet.', valueHint: 'TRUE or FALSE', example: 'CIVIL_CROSSSECTION_STACK_TOP_DOWN = TRUE' },
  { name: 'CIVIL_CROSSSECTION_REVERSE_STATION_ENABLE', category: 'civil', documentation: 'When `TRUE`, exposes an option to create cross sections in reverse station order.', valueHint: 'TRUE or FALSE', example: 'CIVIL_CROSSSECTION_REVERSE_STATION_ENABLE = TRUE' },
  { name: 'CIVIL_PROFILE_HORIZONTAL_GEOMETRY_INFO', category: 'civil', documentation: 'Displays horizontal geometry information in dynamic profile view by default.', valueHint: '0 or 1', example: 'CIVIL_PROFILE_HORIZONTAL_GEOMETRY_INFO = 1' },
  { name: 'CIVIL_PROFILE_HORIZONTAL_GEOMETRY_HTPS', category: 'civil', documentation: 'Companion setting for default horizontal geometry information in dynamic profile view.', valueHint: '0 or 1', example: 'CIVIL_PROFILE_HORIZONTAL_GEOMETRY_HTPS = 1' },
  { name: 'CIVIL_PROFILE_STATION_LOCK_INTERVAL', category: 'civil', documentation: 'Station lock interval used with dynamic profile geometry info.', valueHint: 'Numeric', example: 'CIVIL_PROFILE_STATION_LOCK_INTERVAL = 100' },
  { name: 'CIVIL_COMPONENTCENTER_DOWNLOADEDCELLSLIB', category: 'civil', documentation: 'Target cell library used by Component Center when downloading components and creating cell content.', example: '%if exists ($(_USTN_WORKSETSTANDARDS)Cell/)\nCIVIL_COMPONENTCENTER_DOWNLOADEDCELLSLIB = $(_USTN_WORKSETSTANDARDS)Cell/Downloaded Component Center Cells.cel\n%else\nCIVIL_COMPONENTCENTER_DOWNLOADEDCELLSLIB = $(MS_DEF)/Downloaded Component Center Cells.cel\n%endif' },
  { name: 'CIVIL_CROSSSECTION_NAVIGATOR_ENABLE_DRAFTING_TOOLS', category: 'civil', documentation: 'Enables drafting tools in the Cross Section Navigator.', valueHint: '0 or 1', example: 'CIVIL_CROSSSECTION_NAVIGATOR_ENABLE_DRAFTING_TOOLS = 1' },
  { name: 'CIVIL_UPGRADE_PROMPT_OFF', category: 'civil', documentation: 'Automatically hides the civil model upgrade prompt and upgrades files without prompting.', valueHint: '0 or 1', example: 'CIVIL_UPGRADE_PROMPT_OFF = 1' },
  { name: 'CIVIL_OPEN_OLD_READONLY', category: 'civil', documentation: 'Works with `CIVIL_UPGRADE_PROMPT_OFF` to hide upgrade prompts and open older models read-only.', valueHint: '0 or 1', example: 'CIVIL_UPGRADE_PROMPT_OFF = 1\nCIVIL_OPEN_OLD_READONLY = 1' },
  { name: 'CIVIL_ANNOTATIONS_IMPORTEXPORT_VISIBLE', category: 'civil', documentation: 'Makes civil annotations import/export tools visible for admin workflows.', valueHint: '0 or 1', example: 'CIVIL_ANNOTATIONS_IMPORTEXPORT_VISIBLE = 1' },
  { name: 'ORD_CONNECT_WORKSPACE_DIR', category: 'civil', documentation: 'Root directory of the ORD CONNECT Workspace. Often set as a Windows environment variable.', example: 'ORD_CONNECT_WORKSPACE_DIR = C:/MICROSTATION_CONNECT_WORKSPACE/' },
  { name: 'MS_DGNTEXTEDITORFAVORITESYMBOLS', category: 'user', documentation: 'Path to the XML file storing favorite symbols for the DGN text editor.', example: 'MS_DGNTEXTEDITORFAVORITESYMBOLS = $(CIVIL_ORGANIZATION_STANDARDS)Text/FavoriteSymbols.xml' },
  { name: 'MS_ALLOWREADONLYITEMEDIT', category: 'user', documentation: 'Controls editing of Item Types or related metadata on read-only content. Bentley includes this in its current Item Types variable checklist.', valueHint: '0 or 1' },
  { name: 'ITEMTYPE_LOOKUP', category: 'user', documentation: 'Current Item Types lookup variable. Bentley notes this replaces the older `ITEMTYPE_EXCELLOOKUP` name.', example: 'ITEMTYPE_LOOKUP = $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/Item Types/Lookup.xlsx' },
  { name: 'ITEMTYPE_PRIORITY_MAP_PATH', category: 'user', documentation: 'Path to the JSON priority map controlling how Item Type conflicts are resolved command-by-command.', example: 'ITEMTYPE_PRIORITY_MAP_PATH = $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/Item Types/Civil Item Type Priority.json' },
  { name: 'ITEMTYPE_EXCELLOOKUP', category: 'user', documentation: 'Deprecated Item Types lookup variable name. Bentley states this has been renamed to `ITEMTYPE_LOOKUP`.', valueHint: 'Deprecated / use ITEMTYPE_LOOKUP instead' },
  { name: 'SUDA_SEED_FILE', category: 'user', documentation: 'Path and file name for the drainage and utilities seed DGNLib used by SUDA workflows.', example: 'SUDA_SEED_FILE = $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/xDOT_Drainage and Utilities Features Annotations Imperial.dgnlib' },
  { name: 'SUE_SEED_FILE', category: 'user', documentation: 'Path and file name for the subsurface utilities engineering seed DGNLib.', example: 'SUE_SEED_FILE = $(CIVIL_ORGANIZATION_STANDARDS)Dgnlib/xDOT_Drainage and Utilities Features Annotations Imperial.dgnlib' },
  { name: '_USTN_OUT', category: 'user', documentation: 'Output directory used by certain print and export workflows. Bentley print examples set this to the active DGN directory.', example: '_USTN_OUT = $(_DGNDIR)' },
  { name: '_CIVIL_STANDARDS_IMPORTEXPORT', category: 'user', documentation: 'Enables civil standards import/export admin functionality.', valueHint: '0 or 1', example: '_CIVIL_STANDARDS_IMPORTEXPORT = 1' },
  { name: '_USTN_RESTRICT_MANAGE_CONFIGURATION', category: 'user', documentation: 'Blocks access to the configuration manager UI.', valueHint: '0 or 1', example: '_USTN_RESTRICT_MANAGE_CONFIGURATION = 1' },
  { name: '_USTN_CELLPLACEMENTPERFORMANCE', category: 'user', documentation: 'Improves cell placement performance, especially when the Properties panel is open.', valueHint: 'true or false', example: '_USTN_CELLPLACEMENTPERFORMANCE = true' },
  { name: '_USTN_PLACENOTE_ACTIVATE_TEXTSTYLE_OF_ACTIVEDIMSTYLE', category: 'user', documentation: 'For ORD 2024+, uses the active text style of the selected dimension style when placing notes.', valueHint: '0 or 1', example: '_USTN_PLACENOTE_ACTIVATE_TEXTSTYLE_OF_ACTIVEDIMSTYLE = 1' },

  // DMWF framework variables (_DYNAMIC_*)
  { name: '_DYNAMIC_DATASOURCE', category: 'user', documentation: 'Expands to the ProjectWise datasource root (`@:`). Set in the Predefined-level CSB. All other _DYNAMIC_ root paths are derived from this.', example: '_DYNAMIC_DATASOURCE = @:' },
  { name: '_DYNAMIC_DATASOURCE_BENTLEYROOT', category: 'user', documentation: 'Full PW path to the DMWF Bentley root folder (contains Configuration/, Common_Predefined.cfg, etc.). This is the master anchor for all DMWF paths.', example: '_DYNAMIC_DATASOURCE_BENTLEYROOT : @:Resources\\Bentley\\' },
  { name: '_DYNAMIC_DATASOURCE_BENTLEYROOT_NAME', category: 'user', documentation: 'Last directory segment of _DYNAMIC_DATASOURCE_BENTLEYROOT, extracted via LASTDIRPIECE(). Used for display/logging.', example: '_DYNAMIC_DATASOURCE_BENTLEYROOT_NAME = $(LASTDIRPIECE(_DYNAMIC_DATASOURCE_BENTLEYROOT))' },
  { name: '_DYNAMIC_CEWORKSPACENAME', category: 'user', documentation: 'Name of the CONNECT Edition Workspace (matches the folder under Configuration/WorkSpaces/ and the corresponding .cfg file). Set in the WorkArea PWSetup cfg.', example: '_DYNAMIC_CEWORKSPACENAME = CEWorkspaceExampleAdv' },
  { name: '_DYNAMIC_CEWORKSPACEROOT', category: 'user', documentation: 'Full path to the CE Workspace root folder (Configuration/WorkSpaces/[WorkspaceName]/).', example: '_DYNAMIC_CEWORKSPACEROOT = $(_DYNAMIC_CEWORKSPACESROOT)$(_DYNAMIC_CEWORKSPACENAME)/' },
  { name: '_DYNAMIC_CEWORKSPACESROOT', category: 'user', documentation: 'Path to the WorkSpaces directory within the Configuration root.', example: '_DYNAMIC_CEWORKSPACESROOT = $(_USTN_CONFIGURATION)WorkSpaces/' },
  { name: '_DYNAMIC_CONFIGURATIONROOT', category: 'user', documentation: 'Path to the configuration root directory (the folder containing WorkSpaces/, Organization/, etc.). Mapped to _USTN_CONFIGURATION.', example: '_DYNAMIC_CONFIGURATIONROOT = $(_DYNAMIC_DATASOURCE_BENTLEYROOT)Configuration/' },
  { name: '_DYNAMIC_CONFIGURATIONNAME', category: 'user', documentation: 'Name of the Configuration folder (default: "Configuration"). Can be overridden for different versions (e.g., "Configuration2024").', example: '_DYNAMIC_CONFIGURATIONNAME : Configuration' },
  { name: '_DYNAMIC_WORKAREA', category: 'user', documentation: 'Full PW path to the current work area (project folder), populated from DMS_PROJECT(_DGNDIR) at Predefined level. The primary anchor for WorkSet identification.', example: '%if exists ($(DMS_PROJECT(_DGNDIR)))\n    _DYNAMIC_WORKAREA : $(DMS_PROJECT(_DGNDIR))\n%endif' },
  { name: '_DYNAMIC_WORKAREA_NAME', category: 'user', documentation: 'Last directory segment of _DYNAMIC_WORKAREA — i.e., the ProjectWise workarea folder name.', example: '_DYNAMIC_WORKAREA_NAME : $(LASTDIRPIECE(_DYNAMIC_WORKAREA))' },
  { name: '_DYNAMIC_WORKAREAROOT', category: 'user', documentation: 'Resolved root path of the work area, used as the base for WorkSet configuration lookups.', example: '_DYNAMIC_WORKAREAROOT : $(_DYNAMIC_WORKAREA)' },
  { name: '_DYNAMIC_WORKAREAROOT_NAME', category: 'user', documentation: 'Name portion of _DYNAMIC_WORKAREAROOT, used to look up WorkSet CFG and DGNWS files by name.', example: '_DYNAMIC_WORKAREAROOT_NAME : $(lastdirpiece(_DYNAMIC_WORKAREAROOT))' },
  { name: '_DYNAMIC_WORKSET_DEFAULTNAME', category: 'user', documentation: 'Fallback WorkSet name when the work area name does not match any CFG file. Set in the Workspace PWSetup file.', example: '_DYNAMIC_WORKSET_DEFAULTNAME : ConnectExample' },
  { name: '_DYNAMIC_WORKSET_NAME', category: 'user', documentation: 'Resolved name for the current WorkSet — typically $(_DYNAMIC_WORKAREAROOT_NAME) or the default name.', example: '_DYNAMIC_WORKSET_NAME : $(_DYNAMIC_WORKAREAROOT_NAME)' },
  { name: '_DYNAMIC_PWSETUP_PATH', category: 'user', documentation: 'Relative sub-path within each root folder where PWSetup control files are stored. Default: `_PWSetup/`', example: '_DYNAMIC_PWSETUP_PATH : _PWSetup/' },
  { name: '_DYNAMIC_WORKAREA_PWSETUP_PATH', category: 'user', documentation: 'Path within the work area folder where WorkArea PWSetup cfg files are located. Default: `_PWSetup/`.', example: '_DYNAMIC_WORKAREA_PWSETUP_PATH : _PWSetup/' },
  { name: '_DYNAMIC_WORKAREA_CFG_PATH', category: 'user', documentation: 'Sub-path within the work area for WorkSet CFG files. Default: `_PWSetup/WorkSets/`', example: '_DYNAMIC_WORKAREA_CFG_PATH : _PWSetup/WorkSets/' },
  { name: '_DYNAMIC_WORKAREA_CFG_ROOT', category: 'user', documentation: 'Full resolved path to the directory containing WorkSet CFG files. Used to locate the WorkSet .cfg and .dgnws files.', example: '_DYNAMIC_WORKAREA_CFG_ROOT : $(_DYNAMIC_WORKAREAROOT)$(_DYNAMIC_WORKAREA_CFG_PATH)' },
  { name: '_DYNAMIC_WORKAREA_WORKSET_PATH', category: 'user', documentation: 'Sub-path from the work area root to the WorkSet data root (often empty or a sub-folder like `CADFILES/`).', example: '_DYNAMIC_WORKAREA_WORKSET_PATH : $(_DYNAMIC_WORKAREA_SUBPATH)' },
  { name: '_DYNAMIC_WORKAREA_SUBPATH', category: 'user', documentation: 'Additional sub-path within the work area to reach WorkSet data. Default is empty (work area IS the workset root). Set to `CADFILES/` etc. for deeper structures.', example: '_DYNAMIC_WORKAREA_SUBPATH : CADFILES/' },
  { name: '_DYNAMIC_CONFIGS', category: 'user', documentation: 'Running log of all loaded CFG files and their versions. Append with `>` from each file. Used for diagnostics and version tracking.', example: '_DYNAMIC_CONFIGS > Common_Predefined.cfg 24.0.0.0' },
  { name: '_DYNAMIC_MSG_VALIDATION', category: 'user', documentation: 'Accumulates diagnostic messages during configuration load. Append with `>`. If _DYNAMIC_DEBUG_COMMONPREDEFINED=1, displayed as an error at end of load.', example: '_DYNAMIC_MSG_VALIDATION > VAR: _USTN_CONFIGURATION=$(dir(_USTN_CONFIGURATION))' },
  { name: '_DYNAMIC_MSG_NOT_FOUND', category: 'user', documentation: 'Standard "NOT FOUND:" prefix string used in DMWF error and validation messages.', example: '_DYNAMIC_MSG_NOT_FOUND : NOT FOUND:' },
  { name: '_DYNAMIC_WORKSPACEGROUPNAME', category: 'user', documentation: 'Name of the Workspace Group (client). When defined, routes configuration lookups through the ClientWorkspaces hierarchy.', example: '_DYNAMIC_WORKSPACEGROUPNAME = ClientName' },
  { name: '_DYNAMIC_WORKSPACEGROUPROOT', category: 'user', documentation: 'Full path to the specific workspace group folder within _DYNAMIC_WORKSPACEGROUPSROOT.', example: '_DYNAMIC_WORKSPACEGROUPROOT = $(_DYNAMIC_WORKSPACEGROUPSROOT)$(_DYNAMIC_WORKSPACEGROUPNAME)/' },
  { name: '_DYNAMIC_WORKSPACEGROUPSROOT', category: 'user', documentation: 'Root path containing all workspace group (client) folders. Can point to a PW folder using @: or a local path.', example: '_DYNAMIC_WORKSPACEGROUPSROOT = @:ClientWorkspaces/' },
  { name: '_DYNAMIC_WORKSPACEGROUP_CONFIGURATIONNAME', category: 'user', documentation: 'Name of the Configuration folder within a Workspace Group root. Allows different clients to use different configuration versions.', example: '_DYNAMIC_WORKSPACEGROUP_CONFIGURATIONNAME = Configuration2024' },
  { name: '_DYNAMIC_CONNECTEDPROJECT', category: 'user', documentation: 'Full PW path to the iTwin Connected Project associated with the current document\'s folder, populated from DMS_CONNECTEDPROJECT(_DGNDIR).', example: '_DYNAMIC_CONNECTEDPROJECT : $(DMS_CONNECTEDPROJECT(_DGNDIR))' },
  { name: '_DYNAMIC_CONNECTEDPROJECTNAME', category: 'user', documentation: 'Name of the Connected Project (last directory segment of _DYNAMIC_CONNECTEDPROJECT).', example: '_DYNAMIC_CONNECTEDPROJECTNAME : $(LASTDIRPIECE(_DYNAMIC_CONNECTEDPROJECT))' },
  { name: '_DYNAMIC_CHECK_VERSION', category: 'user', documentation: 'When set to 1, enables the product version check in the Workspace PWSetup file. Prevents loading with wrong application version.', example: '_DYNAMIC_CHECK_VERSION : 1', valueHint: '0 or 1' },
  { name: '_DYNAMIC_IS_RADS_JOB', category: 'user', documentation: 'Set to 1 when the configuration is loaded by a RADS (Rendering and Document Services) rendition job. Disables interactive UI components.', example: '_DYNAMIC_IS_RADS_JOB : 0', valueHint: '0 or 1' },
  { name: '_DYNAMIC_PRODUCT_VERSION_GEN_MAJ', category: 'user', documentation: 'The generation.major version string of the currently running application (e.g., "24.00"). Used in version check logic.', valueHint: 'Read-only — set by Common_Predefined_ProductVersion.cfg' },
  { name: 'PW_MWP_COMPARISON_IGNORE_LIST', category: 'user', documentation: 'Semicolon-separated list of additional variables ignored when comparing the active file workspace to the managed workspace of the document being opened. Bentley documents `_DGNDIR` and `_DGNFILE` as default ignore entries because they vary per document/session.', example: 'PW_MWP_COMPARISON_IGNORE_LIST = PW_MWP_COMPARISON_IGNORE_LIST;_DGNDIR;_DGNFILE\n%lock PW_MWP_COMPARISON_IGNORE_LIST' },

  // ProjectWise integrated MicroStation (MCM.USER.CFG) variables
  { name: '_MCM_PROMPTFORWORKSPACE', category: 'user', documentation: 'If enabled and set to 1, ProjectWise-integrated MicroStation prompts the user to change workspace settings before opening. If commented out, no prompt is shown.', valueHint: '0 or 1', example: '_MCM_PROMPTFORWORKSPACE = 1' },
  { name: '_MCM_RELOAD_WORKSPACE', category: 'user', documentation: 'Controls how integrated MicroStation reacts when opening a document whose workspace differs from the active document. Bentley documents values 1 and 2 for managed/unmanaged workspace reload behavior; leaving it blank behaves like commented out.', valueHint: '1 or 2', example: '_MCM_RELOAD_WORKSPACE = 1' },
  { name: '_MCM_WORKSPACE_LOCK', category: 'user', documentation: 'If enabled and set to 1, integrated MicroStation does not load the workspace associated with the selected ProjectWise document. When commented out, the associated workspace loads normally.', valueHint: '0 or 1', example: '_MCM_WORKSPACE_LOCK = 1' },
  { name: 'PW_INTEGRATEDAPPCLASSNAME', category: 'user', documentation: 'Identifies the integrated application class name used by ProjectWise automatic login and related integration settings. Bentley documents the default MicroStation value as `MicroStation`.', example: 'PW_INTEGRATEDAPPCLASSNAME = MicroStation' },
  { name: 'PW_BSILOG_ENABLE', category: 'user', documentation: 'Turns ProjectWise integrated MicroStation logging on or off. Bentley documents this as enabled by default in MCM.USER.CFG.', valueHint: '0 or 1', example: 'PW_BSILOG_ENABLE = 1' },
  { name: 'PW_BSILOG_CONFIG_FILE', category: 'user', documentation: 'Path to the logging configuration file used by integrated MicroStation. Bentley documents the default as `$(PWDIR)bin/mcm.log.xml`.', example: 'PW_BSILOG_CONFIG_FILE = $(PWDIR)bin/mcm.log.xml' },
  { name: 'PW_DISABLE_BINARY_COMPATIBILITY_CHECK', category: 'user', documentation: 'Disables the ProjectWise check that verifies the running MicroStation build is binary compatible with ProjectWise Explorer. Bentley recommends leaving this alone unless intentionally avoiding integrated mode with an unsupported version.', valueHint: '0 or 1' },
  { name: 'PW_REFERENCE_MODE', category: 'user', documentation: 'Controls ProjectWise reference update checking in integrated MicroStation. Bentley documents: 1 = prompt to reload updated references, 2 = silently reload updated references, 3 or commented out = do not check.', valueHint: '1, 2, or 3', example: 'PW_REFERENCE_MODE = 2' },
  { name: 'PW_REFERENCE_TIMER', category: 'user', documentation: 'Polling interval in minutes for updated reference checks when `PW_REFERENCE_MODE` is 1 or 2. Bentley documents 30 minutes as the default when this variable is not enabled.', valueHint: 'Positive integer', example: 'PW_REFERENCE_TIMER = 15' },
  { name: 'PW_RESOLVEREFERENCES', category: 'user', documentation: 'Scans the file being opened for unresolved references that appear to come from ProjectWise. Bentley documents: 1 = show all matching files, 2 = show only matching files the user can access.', valueHint: '1 or 2', example: 'PW_RESOLVEREFERENCES = 2' },
  { name: 'PW_CHECKINOPT', category: 'user', documentation: 'Controls what happens when a checked-out document is closed in integrated MicroStation. Bentley documents: commented out = show Check In dialog, 1 = silent check-in, 0 = close without prompting and without check-in.', valueHint: '0 or 1', example: 'PW_CHECKINOPT = 1' },
  { name: 'PW_DONT_WARN_ON_REFERENCE_MODIFY', category: 'user', documentation: 'Suppresses warnings when reference files are moved or renamed. Bentley documents 1 = do not warn, 0 or commented out = show warnings.', valueHint: '0 or 1' },
  { name: 'PW_CAPTIVEENVIRONMENT', category: 'user', documentation: 'Controls whether integrated MicroStation is captive to ProjectWise dialogs only. Bentley documents: 1 = stay in ProjectWise dialogs only, 0 or commented out = Cancel can fall back to native MicroStation file-system dialogs.', valueHint: '0 or 1', example: 'PW_CAPTIVEENVIRONMENT = 1' },
  { name: 'PW_DONT_RESOLVE_APPLICATION', category: 'user', documentation: 'Controls the default Application filter in the integrated File Open dialog. Bentley documents: 1 = always default to All Applications, 0 or commented out = remember/use the resolved application such as MicroStation.', valueHint: '0 or 1' },
  { name: 'PW_DISABLE_AUTO_FILE_EXTENSION_GENERATION', category: 'user', documentation: 'Allows the user to type a custom file extension even when ProjectWise file name locking would normally append the default extension automatically.', valueHint: '0 or 1' },
  { name: 'PW_LINKSET_TIMER', category: 'user', documentation: 'Sets how often, in minutes, ProjectWise checks for a newer link set file on the server. Bentley documents this as enabled by default and checking every 5 minutes.', valueHint: 'Positive integer', example: 'PW_LINKSET_TIMER = 5' },
  { name: 'PW_RASTER_CHECKINOPT', category: 'user', documentation: 'Controls how raster attachments are checked in. Bentley documents: -1 or commented out = prompt through Check In dialog, 1 = silent check-in, 0 = do not check in.', valueHint: '-1, 0, or 1' },
  { name: 'PW_RASTER_CHECKOUTOPT', category: 'user', documentation: 'Controls how raster attachments are checked out. Bentley documents: -1 or commented out = confirm checkout, 1 = silent checkout, 0 = do not check out.', valueHint: '-1, 0, or 1' },
  { name: 'PW_RASTER_COPYOUT_READWRITE', category: 'user', documentation: 'If enabled, copied-out raster attachments are opened with read/write access instead of read-only access.', valueHint: '0 or 1' },
  { name: 'MS_RASTER_PROJECTWISE_WARNING_ONCLOSE_DISABLE', category: 'user', documentation: 'Controls whether Raster Manager shows a warning on close when it believes a ProjectWise raster file has changed. Bentley documents 1 = show warning, 0 or commented out = do not show warning.', valueHint: '0 or 1' },
  { name: 'PW_TITLEBLOCKS_ENABLE_PROGRESSBAR', category: 'user', documentation: 'Controls whether a progress bar is shown while title block tags are being updated from ProjectWise.', valueHint: '0 or 1' },
  { name: 'PW_TITLEBLOCKS_ENABLE_PRESCANNING', category: 'user', documentation: 'If enabled, the title block module checks whether a reference contains title blocks before attempting to fetch title block attribute values from ProjectWise. Bentley documents this as enabled by default.', valueHint: '0 or 1' },
  { name: 'PW_TITLEBLOCKS_SKIP_TAGS_IN_REFERENCES', category: 'user', documentation: 'Prevents title block tags in references from being updated. Bentley notes this makes `PW_TITLEBLOCKS_NO_UPDATE_ON_REFRELOAD` unnecessary when enabled.', valueHint: '0 or 1' },
  { name: 'PW_TITLEBLOCKS_NO_UPDATE_ON_REFRELOAD', category: 'user', documentation: 'Prevents title block tags in references from being updated during reference reload operations. Bentley notes this should not be enabled together with `PW_TITLEBLOCKS_SKIP_TAGS_IN_REFERENCES` unless you intentionally want no reference title block updates at all.', valueHint: '0 or 1' },
  { name: 'PW_UPDATE_TITLEBLOCKS_ALWAYS', category: 'user', documentation: 'If enabled, title blocks are updated every time the active model changes. Otherwise they are typically updated only once per model per session.', valueHint: '0 or 1' },
  { name: 'PW_TITLEBLOCKS_UPDATE_READONLY', category: 'user', documentation: 'Allows title block attributes to be updated even in files opened read-only.', valueHint: '0 or 1' },
  { name: 'PW_REFUPDT_CHK_ONCE', category: 'user', documentation: 'If enabled and set to 1, reference attachments are verified only once per session.', valueHint: '0 or 1' },
  { name: 'PW_VERIFY_FOR_DELETED_REFS', category: 'user', documentation: 'Prevents deleted reference files from being loaded from stale local working copies. Bentley documents: 1 = do not load deleted references, 0 or commented out = local deleted references may still load.', valueHint: '0 or 1', example: 'PW_VERIFY_FOR_DELETED_REFS = 1' },

  // System/platform read-only variables
  { name: '_DGNDIR', category: 'user', documentation: 'Full PW path to the directory containing the currently open DGN/DWG file. Key anchor for dynamic workspace resolution — used with DMS_PROJECT() etc.', valueHint: 'Read-only — set by ProjectWise Explorer' },
  { name: '_DGNFILE', category: 'user', documentation: 'Filename (without path) of the currently open DGN/DWG file.', valueHint: 'Read-only — set by ProjectWise Explorer' },
  { name: '_ENGINENAME', category: 'user', documentation: 'Name of the running application engine. Matches the product name: "MicroStation", "OpenRoadsDesigner", "OpenBridgeModeler", "OpenRailDesigner", etc. Use in %if conditions for product-specific config.', valueHint: 'Read-only — e.g., "OpenRoadsDesigner"', example: '%if $(_ENGINENAME)=="OpenRoadsDesigner"\n    # ORD-specific config\n%endif' },
  { name: '_VERSION_10_0', category: 'user', documentation: 'Defined when the application is a CONNECT Edition (CE) product. Use in %if %ifdef to distinguish CE from V8i.', valueHint: 'Read-only — defined by application' },
  { name: '_VERSION_8_11', category: 'user', documentation: 'Defined when the application is a V8i product (MicroStation V8i, ORD CONNECT prior to CE). DMWF 24.0 no longer supports V8; this is kept for deprecation checks.', valueHint: 'Read-only — defined by application' },
  { name: '_PLATFORMNAME', category: 'user', documentation: 'Name of the OS platform (e.g., "WINNT").', valueHint: 'Read-only — e.g., "WINNT"' },
  { name: '_ROOTDIR', category: 'user', documentation: 'Root directory of the Bentley application installation (the folder containing the MicroStation.exe or equivalent).', valueHint: 'Read-only — set by application' },
  { name: '_WINNT', category: 'user', documentation: 'Defined when running on Windows NT/10/11. Use in %ifdef for OS-conditional configuration.', valueHint: 'Read-only — defined on Windows' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Built-in function hover docs (Keywords4 in UDL)
// ─────────────────────────────────────────────────────────────────────────────

const BUILTIN_FUNCTIONS: Record<string, string> = {
  'lastdirpiece': '**LASTDIRPIECE(var)** — Returns the last directory segment of a path variable.\n\nExample: if `_DYNAMIC_WORKAREA = @:Projects/Bridge/`, then `$(LASTDIRPIECE(_DYNAMIC_WORKAREA))` returns `Bridge`.\n\nCase-insensitive in the CFG engine.',
  'parentdevdir': '**parentdevdir(var)** — Strips the final directory segment and the device/drive prefix from a path, returning the parent directory portion.\n\nUsed to navigate to sibling folders: `$(parentdevdir(_DYNAMIC_DATASOURCE_BENTLEYROOT))ClientWorkspaces/`',
  'parentdir': '**parentdir(var)** — Returns the parent directory of the path (one level up), retaining the drive/device.',
  'devdir': '**devdir(var)** — Returns the device (drive letter or UNC server) plus directory of a path variable.',
  'dev': '**dev(var)** — Returns only the device/drive portion of a path variable (e.g., `C:`).',
  'dir': '**dir(var)** — Returns the directory portion of a path variable, including trailing separator.',
  'basename': '**basename(var)** — Returns the base filename without extension.',
  'filename': '**filename(var)** — Returns the full filename (base + extension) from a path variable.',
  'ext': '**ext(var)** — Returns the file extension (including the dot) from a path variable.',
  'noext': '**noext(var)** — Returns the full path with the file extension removed.',
  'first': '**first(var)** — Returns the first entry from a semicolon-separated search path variable.',
  'concat': '**concat(var1,var2)** — Concatenates two variable values.',
  'build': '**build(var)** — Returns the build number portion of a version string variable.',
  'registryread': '**registryread(key,value)** — Reads a value from the Windows registry. Used in DMWF version detection (e.g., reading PW Explorer version).\n\nExample: `$(registryread(HKLM\\\\SOFTWARE\\\\...,DisplayVersion))`',
  'dms_project': '**DMS_PROJECT(var)** — Returns the full ProjectWise datasource path to the PW workarea (project folder) that contains the path in *var*. Always used with `_DGNDIR`.\n\nExample: `$(DMS_PROJECT(_DGNDIR))` returns the PW workarea containing the open document.',
  'dms_parentproject': '**DMS_PARENTPROJECT(var)** — Returns the parent workarea of the folder in *var*. Used for nested workarea structures.\n\nExample: `$(DMS_PARENTPROJECT(_DGNDIR))`',
  'dms_connectedproject': '**DMS_CONNECTEDPROJECT(var)** — Returns the PW path to the iTwin Connected Project linked to the folder in *var*.\n\nExample: `$(DMS_CONNECTEDPROJECT(_DGNDIR))`',
  'dms_connectedprojectguid': '**DMS_CONNECTEDPROJECTGUID(var)** — Returns the GUID of the iTwin Connected Project linked to the folder in *var*. Mapped to `_USTN_CONNECT_PROJECTGUID`.',
};

const DIRECTIVES = [
  { name: '%include', doc: 'Include one or more configuration files. Can include wildcards. Optionally specify a processing level.' },
  { name: '%if', doc: 'Begin a conditional block. Supports exists(), defined(), and logical operators && and ||.' },
  { name: '%ifdef', doc: 'Begin a conditional block that executes if the specified variable is defined.' },
  { name: '%ifndef', doc: 'Begin a conditional block that executes if the specified variable is NOT defined.' },
  { name: '%else', doc: 'Alternative branch of a %if, %ifdef, or %ifndef block.' },
  { name: '%elseif', doc: 'Additional conditional branch (also written as %elif).' },
  { name: '%endif', doc: 'Closes a %if, %ifdef, or %ifndef block.' },
  { name: '%lock', doc: 'Locks a configuration variable, preventing it from being overridden at any subsequent level.' },
  { name: '%undef', doc: 'Undefines a configuration variable, removing its value.' },
  { name: '%define', doc: 'Defines a macro name (flag) without a value. Used with %ifdef/%ifndef.' },
  { name: '%level', doc: 'Sets the processing level for subsequent configuration. Levels: 0=System, 1=Application, 2=Organization, 3=WorkSpace, 4=WorkSet, 5=Role, 6=User.' },
  { name: '%error', doc: 'Emits an error message and halts configuration processing.' },
  { name: '%warning', doc: 'Emits a warning message during configuration processing.' },
];

const OPERATORS = [
  { op: '=', doc: 'Assign variable at current level, overriding any previous value.' },
  { op: '>', doc: 'Append value to existing variable, separated by semicolons (path append).' },
  { op: '<', doc: 'Prepend value to existing variable, separated by semicolons (path prepend).' },
  { op: ':', doc: 'Assign variable only if it is not already defined (default/fallback assignment).' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Completion Provider
// ─────────────────────────────────────────────────────────────────────────────

class BentleyCfgCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const lineText = document.lineAt(position).text;
    const prefix = lineText.substring(0, position.character);
    const items: vscode.CompletionItem[] = [];

    // ── Inside a $(...) or ${...} variable reference ──
    const varRefMatch = prefix.match(/\$[({]([A-Za-z_]*)$/);
    if (varRefMatch) {
      return this.variableReferenceCompletions(varRefMatch[1]);
    }

    // ── At the start of a line: directive completions ──
    if (/^\s*%[A-Za-z]*$/.test(prefix)) {
      return this.directiveCompletions();
    }

    // ── After %level ──
    if (/^\s*%level\s+\S*$/.test(prefix)) {
      return this.levelCompletions();
    }

    // ── At the start of a line: variable name completions ──
    if (/^\s*[A-Za-z_][A-Za-z0-9_]*$/.test(prefix.trimStart())) {
      for (const v of CFG_VARIABLES) {
        const item = new vscode.CompletionItem(v.name, vscode.CompletionItemKind.Variable);
        item.detail = `[${v.category.toUpperCase()}] Configuration Variable`;
        item.documentation = new vscode.MarkdownString(
          `**${v.name}**\n\n${v.documentation}${v.example ? `\n\n*Example:*\n\`\`\`\n${v.example}\n\`\`\`` : ''}`
        );
        item.insertText = new vscode.SnippetString(`${v.name} = \${1:${v.valueHint || 'value'}}`);
        items.push(item);
      }
      return items;
    }

    // ── After `=`, `>`, `<`, `:`: suggest $() references ──
    if (/[=><:]\s*\$?[({]?[A-Za-z_]*$/.test(prefix)) {
      return this.variableReferenceCompletions('');
    }

    // ── Inside $(…): suggest built-in functions ──
    if (/\$\([A-Za-z_]*$/.test(prefix)) {
      return this.builtinFunctionCompletions();
    }

    return items;
  }

  private builtinFunctionCompletions(): vscode.CompletionItem[] {
    return Object.entries(BUILTIN_FUNCTIONS).map(([name, doc]) => {
      const item = new vscode.CompletionItem(name.toUpperCase(), vscode.CompletionItemKind.Function);
      item.detail = 'Built-in CFG Function';
      item.documentation = new vscode.MarkdownString(doc);
      item.insertText = new vscode.SnippetString(`${name.toUpperCase()}(\${1:VAR_NAME})`);
      return item;
    });
  }

  private variableReferenceCompletions(typed: string): vscode.CompletionItem[] {
    return CFG_VARIABLES
      .filter(v => v.name.toLowerCase().startsWith(typed.toLowerCase()))
      .map(v => {
        const item = new vscode.CompletionItem(v.name, vscode.CompletionItemKind.Variable);
        item.detail = `[${v.category.toUpperCase()}] ${v.documentation.substring(0, 60)}...`;
        item.documentation = new vscode.MarkdownString(`**${v.name}**\n\n${v.documentation}`);
        item.filterText = v.name;
        return item;
      });
  }

  private directiveCompletions(): vscode.CompletionItem[] {
    return DIRECTIVES.map(d => {
      const item = new vscode.CompletionItem(d.name, vscode.CompletionItemKind.Keyword);
      item.detail = 'Preprocessor Directive';
      item.documentation = new vscode.MarkdownString(d.doc);
      return item;
    });
  }

  private levelCompletions(): vscode.CompletionItem[] {
    const levels = [
      { label: '0', detail: 'System' },
      { label: '1', detail: 'Application' },
      { label: '2', detail: 'Organization' },
      { label: '3', detail: 'WorkSpace' },
      { label: '4', detail: 'WorkSet' },
      { label: '5', detail: 'Role' },
      { label: '6', detail: 'User' },
      { label: 'WorkSpace', detail: 'Level 3' },
      { label: 'WorkSet', detail: 'Level 4' },
      { label: 'Organization', detail: 'Level 2' },
      { label: 'System', detail: 'Level 0' },
      { label: 'Application', detail: 'Level 1' },
      { label: 'Role', detail: 'Level 5' },
      { label: 'User', detail: 'Level 6' },
    ];
    return levels.map(l => {
      const item = new vscode.CompletionItem(l.label, vscode.CompletionItemKind.EnumMember);
      item.detail = l.detail;
      return item;
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hover Provider
// ─────────────────────────────────────────────────────────────────────────────

class BentleyCfgHoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | null {
    const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!range) return null;

    const word = document.getText(range);
    const lineText = document.lineAt(position).text;

    // Check for directive (% prefix on the line)
    const directiveMatch = lineText.match(/^\s*(%\w+)/);
    if (directiveMatch) {
      const directive = DIRECTIVES.find(d => d.name === directiveMatch[1]);
      if (directive) {
        return new vscode.Hover(new vscode.MarkdownString(`**${directive.name}** — Preprocessor Directive\n\n${directive.doc}`));
      }
    }

    // Check for built-in function (Keywords4)
    const funcDoc = BUILTIN_FUNCTIONS[word.toLowerCase()];
    if (funcDoc) {
      return new vscode.Hover(new vscode.MarkdownString(funcDoc), range);
    }

    // Check for known variable
    const variable = CFG_VARIABLES.find(v => v.name === word);
    if (variable) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${variable.name}**\n\n`);
      md.appendMarkdown(`*Category: ${variable.category.toUpperCase()}*\n\n`);
      md.appendMarkdown(variable.documentation);
      if (variable.example) {
        md.appendMarkdown(`\n\n**Example:**\n`);
        md.appendCodeblock(variable.example, 'bentley-cfg');
      }
      if (variable.valueHint) {
        md.appendMarkdown(`\n\n**Value:** \`${variable.valueHint}\``);
      }
      return new vscode.Hover(md, range);
    }

    // Check for operator
    if (['=', '>', '<', ':'].includes(word) || lineText.includes(` ${word} `)) {
      const opInfo = OPERATORS.find(o => o.op === word);
      if (opInfo) {
        return new vscode.Hover(new vscode.MarkdownString(`**\`${opInfo.op}\`** — Assignment Operator\n\n${opInfo.doc}`), range);
      }
    }

    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic / Validation
// ─────────────────────────────────────────────────────────────────────────────

function validateCfgDocument(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
  const diagnostics: vscode.Diagnostic[] = [];
  const lines = document.getText().split('\n');
  const ifStack: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.replace(/#.*$/, '').trimEnd(); // strip comments

    if (!line.trim()) continue;

    // Track %if/%endif nesting
    if (/^\s*%if(?:def|ndef)?\b/.test(line)) {
      ifStack.push(i);
    } else if (/^\s*%endif\b/.test(line)) {
      if (ifStack.length === 0) {
        diagnostics.push(new vscode.Diagnostic(
          new vscode.Range(i, 0, i, rawLine.length),
          '%endif without matching %if / %ifdef / %ifndef',
          vscode.DiagnosticSeverity.Error
        ));
      } else {
        ifStack.pop();
      }
    }

    // Check variable assignment: missing trailing slash on directory paths
    const assignMatch = line.match(/^([A-Za-z_]\w*)\s*[=><:]\s*(.+)$/);
    if (assignMatch) {
      const varName = assignMatch[1];
      const value = assignMatch[2].trim();

      if (varName === 'CIVIL_DEFAULT_STATION_LOCK' && /^true$/i.test(value)) {
        diagnostics.push(new vscode.Diagnostic(
          new vscode.Range(i, 0, i, rawLine.length),
          'Bentley recommends `CIVIL_DEFAULT_STATION_LOCK = 1` instead of `True`.',
          vscode.DiagnosticSeverity.Warning
        ));
      }

      if (varName === 'CIVIL_SURVEY_RETAIN_SURVEY_ON_COPY') {
        diagnostics.push(new vscode.Diagnostic(
          new vscode.Range(i, 0, i, rawLine.length),
          '`CIVIL_SURVEY_RETAIN_SURVEY_ON_COPY` is obsolete and should be removed.',
          vscode.DiagnosticSeverity.Warning
        ));
      }

      if (varName === 'ITEMTYPE_EXCELLOOKUP') {
        diagnostics.push(new vscode.Diagnostic(
          new vscode.Range(i, 0, i, rawLine.length),
          '`ITEMTYPE_EXCELLOOKUP` has been renamed to `ITEMTYPE_LOOKUP`.',
          vscode.DiagnosticSeverity.Information
        ));
      }

      // Directory variables should end with /
      const dirVariables = ['MS_RFDIR', 'MS_CELLLIST', 'MS_DGNLIB', 'MS_PLOTFILES',
        'MS_PLTCFG', 'MS_MDLAPPS', 'MS_MACROS', 'MS_PATTERN', 'MS_GUIDATA',
        'MS_PRINT', 'MS_PRINT_ORGANIZER', 'MS_OUTPUT', 'MS_BACKUP', 'MS_MATERIAL',
        'MS_RENDERDATA', 'MS_VBASEARCHDIRECTORIES', 'MS_VBACOPYOUT', 'MS_PENTABLE',
        'MS_PLTCFG_PATH', 'CIVIL_REPORTS_RESOURCES', '_USTN_WORKSPACEROOT', '_USTN_WORKSPACESTANDARDS',
        '_USTN_WORKSETSROOT', '_USTN_WORKSETROOT', '_USTN_WORKSETSTANDARDS',
        '_USTN_WORKSETDATA', '_USTN_ORGANIZATION', '_USTN_CONFIGURATION',
        '_USTN_CUSTOM_CONFIGURATION', '_USTN_WORKSPACESROOT'];

      if (dirVariables.includes(varName)) {
        // Value doesn't end with / or ) (variable ref) or * (wildcard)
        const strippedValue = value.replace(/#.*$/, '').trim();
        if (strippedValue && !strippedValue.endsWith('/') && !strippedValue.endsWith(')') && !strippedValue.endsWith('*')) {
          diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(i, 0, i, rawLine.length),
            `Directory variable '${varName}' should end with a trailing slash '/'`,
            vscode.DiagnosticSeverity.Warning
          ));
        }
      }
    }

    // Check for Windows-style backslashes — but NOT in PW paths (@: paths use backslashes legitimately in DMWF)
    // Only flag local absolute paths like C:\ that could cause issues
    if (/[A-Za-z]:\\/.test(line) && !/^\s*#/.test(line) && !line.includes('@:') && !line.includes('_DYNAMIC_LOCAL_ROOT')) {
      const col = line.search(/[A-Za-z]:\\/);
      if (col >= 0) {
        diagnostics.push(new vscode.Diagnostic(
          new vscode.Range(i, col, i, col + 3),
          'Hardcoded local Windows path detected. Consider using forward slashes (/) or a variable-based path for portability.',
          vscode.DiagnosticSeverity.Information
        ));
      }
    }

    // Check for spaces in variable names
    const badVarAssign = rawLine.match(/^([A-Za-z_]\w*\s{2,})[=><:]/);
    if (badVarAssign) {
      diagnostics.push(new vscode.Diagnostic(
        new vscode.Range(i, 0, i, rawLine.length),
        'Unexpected whitespace before assignment operator',
        vscode.DiagnosticSeverity.Information
      ));
    }
  }

  // Unclosed %if blocks
  for (const lineNum of ifStack) {
    diagnostics.push(new vscode.Diagnostic(
      new vscode.Range(lineNum, 0, lineNum, lines[lineNum].length),
      'Unclosed %if / %ifdef / %ifndef block — missing %endif',
      vscode.DiagnosticSeverity.Error
    ));
  }

  collection.set(document.uri, diagnostics);
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension Activation
// ─────────────────────────────────────────────────────────────────────────────

import { parseWorkspace, compareWorkspaces, ParseResult } from './cfgParser';
import { ProjectWiseClient, SavedConnection, PwFolder } from './pwClient';
import { WorkspaceExplorerPanel } from './workspaceExplorer';
import {
  extractManagedWorkspace,
  parseManualCsbInput,
  csbToCfgContent,
  listPwApplications,
  getApplicationForFolder,
  CSB_PROCESSING_ORDER,
  CSB_LEVEL_MAP,
  CsbLevel,
} from './csbExtractor';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// In-memory store of the last two loaded parse results for comparison
let lastParseResults: Array<{ label: string; result: ParseResult; rootPath: string }> = [];

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = { language: 'bentley-cfg' };

  // ── Language features ──────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new BentleyCfgCompletionProvider(),
      '$', '(', '{', '%', '_', 'M', 'C'
    )
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, new BentleyCfgHoverProvider())
  );

  const diagnosticCollection = vscode.languages.createDiagnosticCollection('bentley-cfg');
  context.subscriptions.push(diagnosticCollection);

  const validate = (doc: vscode.TextDocument) => {
    if (doc.languageId === 'bentley-cfg') validateCfgDocument(doc, diagnosticCollection);
  };
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(validate));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(validate));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => validate(e.document)));
  vscode.workspace.textDocuments.forEach(validate);

  // ── Simple validation command ─────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.validateFile', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        validateCfgDocument(editor.document, diagnosticCollection);
        vscode.window.showInformationMessage('Bentley CFG: Validation complete.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.insertVariable', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const picked = await vscode.window.showQuickPick(
        CFG_VARIABLES.map(v => ({
          label: v.name,
          description: `[${v.category.toUpperCase()}]`,
          detail: v.documentation.substring(0, 80),
        })),
        { placeHolder: 'Select a variable to insert' }
      );
      if (picked) editor.insertSnippet(new vscode.SnippetString(`$\{(${picked.label})\}`));
    })
  );

  // ── Workspace Explorer ────────────────────────────────────────────────────

  /**
   * Load a local workspace from the file system
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.loadLocalWorkspace', async () => {
      const folder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        openLabel: 'Select Workspace Root Folder',
        title: 'Load Bentley Local Workspace',
      });
      if (!folder || folder.length === 0) return;

      const rootPath = folder[0].fsPath;
      const label = path.basename(rootPath);

      const panel = WorkspaceExplorerPanel.createOrShow(context);
      panel.showLoading(`Loading workspace: ${label}...`);

      const workspaceName = await vscode.window.showInputBox({
        prompt: 'WorkSpace name (optional — for variable seeding)',
        placeHolder: 'e.g. MyClient',
      });
      const worksetName = await vscode.window.showInputBox({
        prompt: 'WorkSet name (optional)',
        placeHolder: 'e.g. ProjectABC',
      });

      try {
        const result = await runParseInBackground(rootPath, {}, workspaceName, worksetName);
        storeResult({ label, result, rootPath });
        panel.showParseResult(result, label, rootPath);
        vscode.window.showInformationMessage(
          `Workspace loaded: ${result.variables.size} variables, ${result.filesProcessed.length} files, ${result.errors.length} issues.`
        );
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to load workspace: ${e}`);
      }
    })
  );

  /**
   * Load a workspace from a single CFG file (single-file view)
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.loadCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'bentley-cfg') {
        vscode.window.showWarningMessage('Open a .cfg file first.');
        return;
      }
      const filePath = editor.document.uri.fsPath;
      const label = path.basename(filePath);
      const panel = WorkspaceExplorerPanel.createOrShow(context);
      panel.showLoading(`Resolving: ${label}...`);
      try {
        const result = await runParseInBackground(filePath);
        storeResult({ label, result, rootPath: filePath });
        panel.showParseResult(result, label, filePath);
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to parse file: ${e}`);
      }
    })
  );

  /**
   * Load a Managed Workspace from ProjectWise via WSG API
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.loadProjectWiseWorkspace', async () => {
      // Load saved connections
      const saved: SavedConnection[] = context.globalState.get('pw.connections', []);

      // Choose or create connection
      const items: vscode.QuickPickItem[] = [
        { label: '$(add) New ProjectWise connection...', description: '' },
        ...saved.map(c => ({
          label: `$(server) ${c.label}`,
          description: `${c.wsgUrl} / ${c.datasource}`,
          detail: c.id,
        })),
      ];

      const chosen = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a ProjectWise connection',
        title: 'Load Managed Workspace from ProjectWise',
      });
      if (!chosen) return;

      let conn: SavedConnection;
      if (chosen.label.includes('New ProjectWise connection')) {
        const newConn = await promptNewConnection();
        if (!newConn) return;
        conn = newConn;
        // Save it
        saved.push(conn);
        await context.globalState.update('pw.connections', saved);
      } else {
        conn = saved.find(c => c.id === chosen.detail)!;
        if (!conn) return;
      }

      // Get password from SecretStorage
      let password = await context.secrets.get(`pw.pass.${conn.id}`);
      if (!password) {
        password = await vscode.window.showInputBox({
          prompt: `Password for ${conn.username}@${conn.wsgUrl}`,
          password: true,
        });
        if (!password) return;
        await context.secrets.store(`pw.pass.${conn.id}`, password);
      }

      const panel = WorkspaceExplorerPanel.createOrShow(context);
      panel.showLoading(`Connecting to ProjectWise: ${conn.label}...`);

      try {
        const client = new ProjectWiseClient({
          wsgUrl: conn.wsgUrl,
          datasource: conn.datasource,
          username: conn.username,
          credential: password,
          authType: conn.authType,
          ignoreSsl: conn.ignoreSsl,
        });

        const pwConn = {
          wsgUrl: conn.wsgUrl,
          datasource: conn.datasource,
          username: conn.username,
          credential: password,
          authType: conn.authType,
          ignoreSsl: conn.ignoreSsl,
        };

        // ── Step 1: Pick a PW Application (mirrors PWE's starting point) ─────
        // CSBs are assigned to the Application, not to folders. The Application
        // determines which Managed Workspace Profile (and therefore which CSBs)
        // are used — exactly as PWE resolves this when a document is opened.
        panel.showLoading('Fetching Applications from ProjectWise...');
        const applications = await listPwApplications(client);

        let applicationInstanceId: string | undefined;
        let folderGuid: string | undefined;
        let documentGuid: string | undefined;
        let label = `PW: ${conn.label}`;

        if (applications.length > 0) {
          // Application list available — user picks the Application first
          const appItems = applications.map(a => ({
            label: `$(beaker) ${a.name}`,
            description: a.managedWorkspaceProfileName
              ? `Managed Workspace: ${a.managedWorkspaceProfileName}`
              : a.description,
            detail: a.instanceId,
          }));
          appItems.push({
            label: '$(folder) Browse by folder instead...',
            description: 'Pick a PW folder (if Application list is unavailable)',
            detail: '__browse_folder__',
          });

          const appPick = await vscode.window.showQuickPick(appItems, {
            placeHolder: 'Select a ProjectWise Application to resolve its Managed Workspace',
            title: 'Load Managed Workspace from ProjectWise',
          });
          if (!appPick) return;

          if (appPick.detail !== '__browse_folder__') {
            applicationInstanceId = appPick.detail!;
            label = `PW: ${conn.label} / ${applications.find(a => a.instanceId === applicationInstanceId)?.name ?? applicationInstanceId}`;
          }
        }

        // If no applications found (or user chose folder browse), pick a folder
        if (!applicationInstanceId) {
          panel.showLoading('Select ProjectWise folder (RichProject navigation or GUID)...');
          const folderSelection = await promptForPwFolderGuid(client, {
            title: 'Select PW Folder',
            placeHolder: 'Select the document folder to resolve WorkSet CSBs',
          });
          if (!folderSelection) return;
          folderGuid = folderSelection.folderGuid;
          label = `PW: ${conn.label} / ${folderSelection.folderLabel}`;

          // Try to look up the Application from the folder
          panel.showLoading('Resolving Application assignment from folder...');
          const app = await getApplicationForFolder(client, folderGuid);
          if (app) {
            applicationInstanceId = app.instanceId;
            vscode.window.showInformationMessage(
              `Resolved Application "${app.name}" from folder. Using its Managed Workspace Profile.`
            );
          }
        }

        // Optionally provide a document or folder GUID for WorkSet/Discipline CSBs.
        // CSBs assigned at WorkSet/Discipline level are tied to the specific PW
        // folder (Work Area) the document lives in — the Application-level CSBs
        // alone don't carry those. The user can supply either:
        //   • A folder GUID (for folder-level CSB assignment)
        //   • A document GUID (extension resolves it to its parent folder via
        //     pwps_dab Get-PWDocument or dmscli aaApi_SelectDocumentByGuid)
        if (applicationInstanceId && !folderGuid) {
          const wantScope = await vscode.window.showQuickPick(
            [
              { label: '$(folder) Select a document folder (WorkSet-level CSBs)', detail: 'folder' },
              { label: '$(file) Enter a document GUID (extension resolves folder)', detail: 'document' },
              { label: '$(pass) Application CSBs only', detail: 'no' },
            ],
            { placeHolder: 'Do you want to include WorkSet/Discipline CSBs for a specific document or folder?' }
          );
          if (wantScope?.detail === 'folder') {
            panel.showLoading('Select document folder (RichProject navigation or GUID)...');
            const folderSelection = await promptForPwFolderGuid(client, {
              title: 'Select Document Folder',
              placeHolder: 'Select the document folder',
            });
            if (folderSelection) {
              folderGuid = folderSelection.folderGuid;
            }
          } else if (wantScope?.detail === 'document') {
            const docGuidInput = await vscode.window.showInputBox({
              title: 'Document GUID',
              prompt: 'Enter the GUID of the ProjectWise document whose CSBs you want to extract',
              placeHolder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
              validateInput: v => v.trim() ? null : 'Document GUID is required.',
            });
            if (docGuidInput?.trim()) {
              documentGuid = docGuidInput.trim();
              label += ` / doc:${documentGuid}`;
            }
          }
        }

        // ── Step 2: Extract CSBs and build working directory ──────────────────
        panel.showLoading('Extracting Configuration Settings Blocks (CSBs)...');
        const extraction = await extractManagedWorkspace(pwConn, {
          datasource: conn.datasource,
          applicationInstanceId,
          folderGuid,
          documentGuid,
        }, client);

        const backendMsg = `Backend: ${extraction.backend} | CSBs: ${extraction.csbs.length}`;
        const warnings = extraction.messages.filter(m => m.level === 'warning' || m.level === 'error');
        if (warnings.length > 0) {
          vscode.window.showWarningMessage(
            `CSB extraction issues (${warnings.length}) — ${backendMsg}`,
            'View Master .tmp'
          ).then(choice => {
            if (choice === 'View Master .tmp') {
              vscode.window.showTextDocument(vscode.Uri.file(extraction.masterTmpPath), { preview: true });
            }
          });
        }

        // ── Step 3: Parse from master .tmp (same as MicroStation -wc argument) ─
        panel.showLoading(`Resolving variables from ${extraction.csbs.length} CSBs...`);
        const result = await runParseInBackground(extraction.masterTmpPath);

        storeResult({ label, result, rootPath: extraction.workDir });
        panel.showParseResult(result, label, extraction.workDir);
        vscode.window.showInformationMessage(
          `PW Managed Workspace loaded: ${extraction.csbs.length} CSBs → ${result.variables.size} variables | ${backendMsg}` +
          (extraction.workspaceName ? ` | Workspace: ${extraction.workspaceName}` : '') +
          (extraction.worksetName ? ` | WorkSet: ${extraction.worksetName}` : '')
        );
      } catch (e) {
        vscode.window.showErrorMessage(`ProjectWise error: ${e}`);
      }
    })
  );

  /**
   * Manage / delete saved PW connections
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.managePwConnections', async () => {
      const saved: SavedConnection[] = context.globalState.get('pw.connections', []);
      if (saved.length === 0) {
        vscode.window.showInformationMessage('No saved ProjectWise connections.');
        return;
      }
      const items = saved.map(c => ({
        label: c.label,
        description: `${c.wsgUrl} / ${c.datasource}`,
        detail: c.id,
      }));
      const chosen = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select connection to delete',
        title: 'Manage Saved ProjectWise Connections',
      });
      if (!chosen) return;
      const updated = saved.filter(c => c.id !== chosen.detail);
      await context.globalState.update('pw.connections', updated);
      await context.secrets.delete(`pw.pass.${chosen.detail}`);
      vscode.window.showInformationMessage(`Removed connection: ${chosen.label}`);
    })
  );

  /**
   * Compare the two most recently loaded workspaces
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.compareWorkspaces', async () => {
      if (lastParseResults.length < 2) {
        vscode.window.showWarningMessage('Load at least 2 workspaces first (use Load Local or Load ProjectWise Workspace).');
        return;
      }

      // Pick left and right
      const pickItems = lastParseResults.map((r, i) => ({
        label: r.label,
        description: `${r.result.variables.size} vars, ${r.result.filesProcessed.length} files`,
        detail: String(i),
      }));

      const leftPick = await vscode.window.showQuickPick(pickItems, { placeHolder: 'Select LEFT / baseline workspace' });
      if (!leftPick) return;
      const rightPick = await vscode.window.showQuickPick(
        pickItems.filter(p => p.detail !== leftPick.detail),
        { placeHolder: 'Select RIGHT / comparison workspace' }
      );
      if (!rightPick) return;

      const left = lastParseResults[parseInt(leftPick.detail!)];
      const right = lastParseResults[parseInt(rightPick.detail!)];

      const compare = compareWorkspaces(left.result, right.result);
      const panel = WorkspaceExplorerPanel.createOrShow(context);
      panel.showCompareResult(compare, left.label, right.label);

      vscode.window.showInformationMessage(
        `Comparison: +${compare.addedCount} added, -${compare.removedCount} removed, ~${compare.changedCount} changed, =${compare.unchangedCount} same`
      );
    })
  );

  /**
   * Compare two local folders directly (quick path)
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.compareFolders', async () => {
      const leftFolder = await vscode.window.showOpenDialog({
        canSelectFolders: true, canSelectFiles: false,
        openLabel: 'Select baseline (LEFT) workspace folder',
      });
      if (!leftFolder) return;
      const rightFolder = await vscode.window.showOpenDialog({
        canSelectFolders: true, canSelectFiles: false,
        openLabel: 'Select comparison (RIGHT) workspace folder',
      });
      if (!rightFolder) return;

      const panel = WorkspaceExplorerPanel.createOrShow(context);
      panel.showLoading('Parsing and comparing workspaces...');

      const [leftResult, rightResult] = await Promise.all([
        runParseInBackground(leftFolder[0].fsPath),
        runParseInBackground(rightFolder[0].fsPath),
      ]);

      const leftLabel = path.basename(leftFolder[0].fsPath);
      const rightLabel = path.basename(rightFolder[0].fsPath);
      storeResult({ label: leftLabel, result: leftResult, rootPath: leftFolder[0].fsPath });
      storeResult({ label: rightLabel, result: rightResult, rootPath: rightFolder[0].fsPath });

      const compare = compareWorkspaces(leftResult, rightResult);
      panel.showCompareResult(compare, leftLabel, rightLabel);
    })
  );


  /**
   * Manual CSB import — for environments without PW client tools installed
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.importCsbManual', async () => {
      const levelPick = await vscode.window.showQuickPick(
        CSB_PROCESSING_ORDER.map(l => ({ label: l, description: `%level ${CSB_LEVEL_MAP[l]}` })),
        { placeHolder: 'Select CSB processing level', title: 'Manual CSB Import' }
      );
      if (!levelPick) return;

      const name = await vscode.window.showInputBox({
        prompt: 'CSB name (for identification)',
        placeHolder: 'e.g. MSta_CE_Configuration_Root',
      });
      if (!name) return;

      const content = await vscode.window.showInputBox({
        prompt: 'Paste CSB variable content (one assignment per line, e.g.  VAR_NAME = value)',
        placeHolder: '_USTN_CONFIGURATION = C:/PW/Configuration/\nMS_RFDIR > $(MS_DATA)rsc/',
        ignoreFocusOut: true,
      });
      if (content === undefined) return;

      // Write to a temp working dir and parse it
      const workDir = path.join(os.tmpdir(), `pw-manual-csb-${Date.now()}`);
      const wsDir = path.join(workDir, 'workspace');
      fs.mkdirSync(wsDir, { recursive: true });

      const csb = parseManualCsbInput(content, levelPick.label as CsbLevel, name);
      const cfgContent = csbToCfgContent(csb, workDir, {});
      const cfgPath = path.join(wsDir, `${csb.id}.cfg`);
      fs.writeFileSync(cfgPath, cfgContent, 'utf8');

      // Open the generated CFG so the user can see / edit it
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(cfgPath));
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(`CSB "${name}" written as ${path.basename(cfgPath)} — you can now load this folder as a workspace.`);
    })
  );

  /**
   * View the most recently generated master .tmp file
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('bentley-cfg.viewMasterTmp', async () => {
      const entry = lastParseResults.find(r => r.rootPath.includes('workspace') && r.rootPath.includes('.tmp'));
      const tmpFiles: string[] = [];

      // Search recent result working dirs for .tmp files
      for (const r of lastParseResults) {
        const wsDir = path.join(r.rootPath, 'workspace');
        if (fs.existsSync(wsDir)) {
          const files = fs.readdirSync(wsDir).filter(f => f.endsWith('.tmp'));
          files.forEach(f => tmpFiles.push(path.join(wsDir, f)));
        }
        if (r.rootPath.endsWith('.tmp') && fs.existsSync(r.rootPath)) {
          tmpFiles.push(r.rootPath);
        }
      }

      if (tmpFiles.length === 0) {
        vscode.window.showInformationMessage('No generated master .tmp files found. Load a ProjectWise Managed Workspace first.');
        return;
      }

      const pick = tmpFiles.length === 1
        ? tmpFiles[0]
        : (await vscode.window.showQuickPick(tmpFiles.map(f => ({ label: path.basename(f), detail: f })), {
            placeHolder: 'Select master config file to view',
          }))?.detail;

      if (pick) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(pick));
        await vscode.window.showTextDocument(doc);
      }
    })
  );

  console.log('Bentley CFG extension activated');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function runParseInBackground(
  rootPath: string,
  envVars: Record<string, string> = {},
  workspaceName?: string,
  worksetName?: string
): Promise<ParseResult> {
  // Run synchronously but wrapped in a promise so VS Code stays responsive
  return new Promise((resolve, reject) => {
    try {
      const result = parseWorkspace(rootPath, envVars, workspaceName || undefined, worksetName || undefined);
      resolve(result);
    } catch (e) {
      reject(e);
    }
  });
}

function storeResult(entry: { label: string; result: ParseResult; rootPath: string }): void {
  // Keep last 5
  lastParseResults = lastParseResults.filter(r => r.rootPath !== entry.rootPath);
  lastParseResults.unshift(entry);
  if (lastParseResults.length > 5) lastParseResults = lastParseResults.slice(0, 5);
}

async function promptForPwFolderGuid(
  client: ProjectWiseClient,
  opts: { title: string; placeHolder: string }
): Promise<{ folderGuid: string; folderLabel: string } | undefined> {
  const mode = await vscode.window.showQuickPick(
    [
      {
        label: '$(organization) Navigate from RichProjects',
        description: "Uses /Project?$filter=isRichProject+eq+'TRUE'&!poly",
        detail: 'rich',
      },
      {
        label: '$(symbol-key) Enter folder GUID',
        description: 'Directly use a known ProjectWise folder instanceId',
        detail: 'guid',
      },
    ],
    {
      title: opts.title,
      placeHolder: 'Choose how to locate the ProjectWise folder',
    }
  );
  if (!mode) return undefined;

  if (mode.detail === 'guid') {
    const guid = await vscode.window.showInputBox({
      title: opts.title,
      prompt: 'Enter ProjectWise folder GUID (instanceId)',
      placeHolder: 'e.g. 2a2f7f9e-....',
      validateInput: value => value.trim() ? null : 'Folder GUID is required.',
    });
    if (!guid) return undefined;
    return { folderGuid: guid.trim(), folderLabel: guid.trim() };
  }

  const richProjects = await client.listRichProjects();
  if (richProjects.length === 0) {
    vscode.window.showWarningMessage('No RichProjects returned. You can use "Enter folder GUID" instead.');
    return undefined;
  }

  type NavState = { parent?: NavState; folder?: PwFolder; subFolders: PwFolder[] };
  let state: NavState = { subFolders: richProjects };

  while (true) {
    const currentLabel = state.folder?.name ?? 'RichProjects';
    const items: Array<{ label: string; description?: string; detail: string }> = [];

    if (state.folder) {
      items.push({
        label: '$(check) Use this folder',
        description: `${state.folder.name} (${state.folder.instanceId})`,
        detail: '__use_current__',
      });
    }
    if (state.parent) {
      items.push({
        label: '$(arrow-left) Up one level',
        description: 'Go back to the previous folder',
        detail: '__up__',
      });
    }

    for (const folder of state.subFolders) {
      items.push({
        label: `$(folder) ${folder.name}`,
        description: folder.description,
        detail: folder.instanceId,
      });
    }

    const pick = await vscode.window.showQuickPick(items, {
      title: opts.title,
      placeHolder: `${opts.placeHolder} • Current: ${currentLabel}`,
      matchOnDescription: true,
    });

    if (!pick) return undefined;

    if (pick.detail === '__use_current__' && state.folder) {
      return { folderGuid: state.folder.instanceId, folderLabel: state.folder.name };
    }

    if (pick.detail === '__up__' && state.parent) {
      state = state.parent;
      continue;
    }

    const selected = state.subFolders.find(f => f.instanceId === pick.detail);
    if (!selected) continue;

    const subFolders = await client.listSubFolders(selected.instanceId);
    state = {
      parent: state,
      folder: selected,
      subFolders,
    };
  }
}

async function promptNewConnection(): Promise<SavedConnection | null> {
  const label = await vscode.window.showInputBox({ prompt: 'Connection label (e.g. "ACME ProjectWise")', placeHolder: 'My PW Server' });
  if (!label) return null;

  const wsgUrl = await vscode.window.showInputBox({
    prompt: 'WSG Base URL',
    placeHolder: 'https://pw-server.company.com/ws',
    value: 'https://',
  });
  if (!wsgUrl) return null;

  const datasource = await vscode.window.showInputBox({
    prompt: 'Datasource name',
    placeHolder: 'pwdb',
  });
  if (!datasource) return null;

  const username = await vscode.window.showInputBox({ prompt: 'Username' });
  if (!username) return null;

  const authTypePick = await vscode.window.showQuickPick(
    ['Basic (username/password)', 'Bearer token'],
    { placeHolder: 'Authentication type' }
  );
  const authType: 'basic' | 'bearer' = authTypePick?.includes('Bearer') ? 'bearer' : 'basic';

  const sslPick = await vscode.window.showQuickPick(
    ['Verify SSL certificate (recommended)', 'Ignore SSL errors (self-signed cert)'],
    { placeHolder: 'SSL verification' }
  );
  const ignoreSsl = sslPick?.includes('Ignore') ?? false;

  return {
    id: `pw-${Date.now()}`,
    label,
    wsgUrl,
    datasource,
    username,
    authType,
    ignoreSsl,
  };
}

export function deactivate(): void {}
