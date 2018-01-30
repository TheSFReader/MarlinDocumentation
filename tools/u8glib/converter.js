/**
 * U8Glib bitmap converter
 * Copyright (C) 2016 João Brázio [https://github.com/jbrazio]
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * By : @jbrazio
 *      @thinkyhead
 *
 * Todo:
 * - Composite status image from logo, nozzle, bed, fan
 * - Slider for threshold (jQuery.ui)
 * - Buttons to shift the image
 * - Show preview image in B/W converted
 * - Show original image (float right)
 *
 */

bitmap_converter = function() {

  // Extend jQuery.event.fix for copy/paste to fix clipboardData
  $.event.fix = (function(originalFix) {
    return function(e) {
      e = originalFix.apply(this, arguments);
      if (e.type.indexOf('copy') === 0 || e.type.indexOf('paste') === 0) {
        e.clipboardData = e.originalEvent.clipboardData;
      }
      return e;
    };
  })($.event.fix);

  var paste_message = 'Paste image or C/C++ here.',
      preview_scale = 4,
      pix_on  = [   0,   0,   0, 255 ],
      pix_off = [ 255, 255, 255,   0 ],
      lcd_off = [   0,  30, 253, 255 ],
      lcd_on  = [ 116, 241, 255, 255 ];

  if (typeof $('canvas')[0].getContext == 'undefined') return;

  var $img        = $('<img/>'),
      $large      = $('#preview-lg'),
      $small      = $('#preview-sm'),
      cnv         = $large[0],
      cnv_sm      = $small[0],
      ctx         = cnv.getContext('2d'),
      ctx_sm      = cnv_sm.getContext('2d'),
      $filein     = $('#file-input'),
      $err        = $('#err-box'),
      $outdiv     = $('#cpp-container'),
      $output     = $('#output'),
      $invert     = $('#inv-on'),
      $binary     = $('#bin-on'),
      $ascii      = $('#ascii-on'),
      $skinny     = $('#skinny-on'),
      $hotends    = $('#hotends'),
      $rj         = $('#rj-on'),
      $bed        = $('#bed-on'),
      $fan        = $('#fan-on'),
      $type       = $('input[name=bitmap-type]'),
      $statop     = $('#stat-sub'),
      $pasted     = $('#pasted'),
      $field_arr  = $('#bin-on, #ascii-on, #skinny-on, #hotends, #rj-on, #bed-on, #fan-on, input[name=bitmap-type]'),
      tohex       = function(b) { return '0x' + ('0' + (b & 0xFF).toString(16)).toUpperCase().slice(-2); },
      tobin       = function(b) { return 'B' + ('0000000' + (b & 0xFF).toString(2)).slice(-8); },
      random_name = function(prefix) { return (prefix||'') + Math.random().toString(36).substring(7); },
      rnd_name, data_source;

  var error_message = function(msg) {
    $err.text(msg).show(); console.log(msg);
  };

  /**
   * Read a Blob of image data given a file reference
   *
   * Called by:
   * - File input field, passing the first selected file.
   * - Image pasted directly into a textfield.
   */
  var load_file_into_image = function(fileref) {
    reader = new FileReader();
    $(reader).one('load', function() {
      load_url_into_image(this.result);
    });
    // Load from the given source 'file'
    reader.readAsDataURL(fileref);
  };

  /**
   * Draw the given image into the canvases.
   */
  var render_image_into_canvases = function($i, notsmall, notlarge) {
    var i = $i[0], iw = i.width, ih = i.height;

    // Draw the image into one or both canvases
    if (!notsmall) {
      // Prepare the small hidden canvas to receive the image
      ctx_sm.canvas.width  = iw;
      ctx_sm.canvas.height = ih;
      ctx_sm.drawImage(i, 0, 0, ctx_sm.canvas.width, ctx_sm.canvas.height);
    }

    // Scaled view so you can actually see the pixels
    if (!notlarge) {
      ctx.canvas.width  = iw * preview_scale;
      ctx.canvas.height = ih * preview_scale;
      //ctx.mozImageSmoothingEnabled = false;
      ctx.imageSmoothingQuality = 'medium';
      ctx.webkitImageSmoothingEnabled = false;
      ctx.msImageSmoothingEnabled = false;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(i, 0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  };

  /**
   * Draw $img into the small and large canvases.
   * Convert the small canvas image data into C text.
   * Display the image and converted text.
   * Focus and select the converted text.
   */
  var generate_cpp = function(e,no_render) {

    // Get the image width and height in pixels.
    var iw = $img[0].width, ih = $img[0].height;

    // Reject images that are too big
    // TODO: Scale images down if needed
    // TODO: Threshold sliders for luminance range to capture.
    if (iw > 128 || ih > 64)
      return error_message("Image too large for display. Maximum 128 x 64.");

    render_image_into_canvases($img, false, no_render);

    // Threshold filter the image into the out[] array
    var out = [],
        dataref = ctx_sm.getImageData(0, 0, iw, ih),
        data = dataref.data;

    var bytewidth = Math.ceil(iw / 8),                    // Bytes wide is important

        type = $type.filter(':checked').val(),            // The selected output type
        name = type == 'boot' ? 'custom_start_bmp' :
               type == 'stat' ? 'status_screen0_bmp' :
               'bitmap_' + rnd_name,

        is_bin = $binary[0].checked,                      // Flags for binary, ascii, and narrow ascii

        tobase = is_bin ? tobin : tohex,

        is_inv = $invert[0].checked,
        zero = is_inv ? (is_bin ? 'B11111111' : '0xFF') : (is_bin ? 'B00000000' : '0x00'),

        is_asc = $ascii[0].checked,                       // Include ASCII version of the bitmap?
        is_thin = $skinny[0].checked,                     // A skinny ASCII output with blocks.

        is_stat = type == 'stat',                         // "Status" has extra options
        is_lpad = is_stat && !$rj[0].checked,              // Right justify?

        extra_x = is_stat ? 16 - bytewidth : 0,           // For now, pad lines with 0x00. TODO: Status screen composer.
        extra_y = is_lpad ? 19 - ih : 0;                   // Pad Y up to 19 lines.

    if (extra_x < 0) extra_x = 0;
    if (extra_y < 0) extra_y = 0;

    var $tcnv, tctx, tref, tdat = [];
    if (!no_render) {
      $tcnv = $('<canvas/>').attr({ 'class':'hideme', 'width':iw, 'height':ih });
      tctx = $tcnv[0].getContext('2d');
      tref = tctx.createImageData(iw, ih);
      tdat = tref.data;
    }

    // Convert to grayscale, perform threshold, and beautify
    for (var i = 0; i < data.length; i += 4) {
      var gray = data[i] * 0.3 + data[i+1] * 0.59 + data[i+2] * 0.11,
          pixel = is_inv != (gray < 127 && data[i+3] > 63),
          c = pixel ? lcd_on : lcd_off;
      out.push(pixel);
      tdat[i] = c[0]; tdat[i+1] = c[1]; tdat[i+2] = c[2]; tdat[i+3] = c[3];
    }

    if (!no_render) {
      tctx.putImageData(tref, 0, 0);
      var $vimg = $('<img/>').width(iw).height(ih)
                    .one('load', function(){ render_image_into_canvases($(this), true, false); })
                    .attr('src', $tcnv[0].toDataURL('image/png'));
    }

    //
    // Convert the b/w image to C++ suitable for Marlin
    //
    if (data_source == 'paste')
      data_source = iw + 'x' + ih + ' pasted image';

    var cpp = '/**\n * Made with Marlin Bitmap Converter\n * http://marlinfw.org/tools/u8glib/converter.html\n *\n' +
              ' * This bitmap from ' + data_source + '\n */\n';

    if (is_stat) {
      if (!is_lpad && extra_x) {
        // If not left-padded move the graphic all the way to the right
        cpp += '#define STATUS_SCREEN_X ' + (extra_x * 8) + '\n';
        extra_x = 0;
      }
      cpp += '#define STATUS_SCREENWIDTH ' + ((bytewidth + extra_x) * 8) + '\n';
    }
    else if (type == 'boot') {
      cpp += '#define CUSTOM_BOOTSCREEN_BMPWIDTH  ' + iw + '\n' +
             '#define CUSTOM_BOOTSCREEN_BMPHEIGHT ' + ih + '\n';
    }
    else {
      var rn = rnd_name.toUpperCase();
      cpp += '#define ' + rn + '_BMPWIDTH  ' + iw + '\n' +
             '#define ' + rn + '_BMPHEIGHT ' + ih + '\n';
    }

    cpp += 'const unsigned char ' + name + '[] PROGMEM = {\n';

    var lastx = iw - 8 - (iw % 8);          // last item in each line
    for (var y = 0; y < ih; y++) {          // loop Y
      var bitline = ' // ';
      cpp += '  ';
      for (var x = 0; x < iw; x += 8) {     // loop X
        var byte = 0;
        for (var b = 0; b < 8; b++) {       // loop 8 bits
          var xx = x + b, i = y * iw + xx,
              bb = xx < iw ? out[i] : is_inv; // a set bit?
          byte = (byte << 1) | bb;          // add to the byte
          bitline += is_thin
                     ? b % 2 ? ['·','▐','▌','█'][byte & 3] : ''
                     : bb ? '#' : '.';
        }
        cpp += tobase(byte)
             + (x == lastx && y == ih - 1 && !extra_x && !extra_y ? ' ' : ',');
      }
      // Fill out the rest of the lines for stat
      for (var x = extra_x; x--;) cpp += zero + (x || y < ih - 1 || extra_y ? ',' : ' ');
      cpp += (is_asc ? bitline : '') + '\n';
    }
    if (extra_y) {
      for (var y = extra_y; y--;) {
        cpp += '  ';
        for (var x = 16; x--;)
          cpp += zero + (x || y ? ',' : '');
        cpp += '\n';
      }
    }

    cpp += '};\n';

    /*
    if (is_stat)
      if ($fan[0].checked)
        cpp += '\n// TODO: Add a second array with FAN FRAME 2 included.\n'
      else
        cpp += '\nconst unsigned char *status_screen1_bmp = status_screen0_bmp;\n'
    */

    $large.css('display','block');
    $outdiv.show();
    $output
      .val(cpp)
      .attr('rows', (cpp.match(/\n/g)||[]).length + 1)
      //.trigger('focus')
    ;

    $('#where').html(
      type == 'boot' ? '<strong><tt>_Bootscreen.h</tt></strong>' :
      type == 'stat' ? '<strong><tt>_Statusscreen.h</tt></strong>' :
      'program'
    );
    return false;
  };

  //
  // Get ready to evaluate incoming data
  //
  var prepare_for_new_image = function() {
    $err.hide();

    // Kill most form actions until an image exists
    $img.off();
    $field_arr.off();
    $invert.off();

    // ASCII is tied to the Narrow option
    $ascii.change(function(){ $skinny.attr('disabled', !this.checked); return false; });

    // For output type "Status" show more options
    $type.change(function() {
      if ($(this).val() == 'stat') $statop.show(); else $statop.hide();
    });
  };

  /**
   * Set the image src to some new data.
   * This will fire $img.load when the data is ready.
   */
  var load_url_into_image = function(data_url, w, h) {

    var img = new Image;
    $img = $(img);

    if (w) $img.width(w);
    if (h) $img.height(h);

    $img.one('load', generate_cpp)      // Generate when the image loads
        .attr('src', data_url);         // Start loading image data

    $field_arr.change(function(e){ generate_cpp(e, true); });
    $invert.change(generate_cpp);

    rnd_name = random_name();           // A new bitmap name on each file load
  };

  var restore_pasted_cpp_field = function() {
    $pasted.val(paste_message).css('color', '');
  };

  //
  // Convert C++ text representation back into an image.
  // Figures out what the correct line length should be
  // before re-scanning for data. Does well screening out
  // most extraneous text.
  //
  var load_pasted_cpp_into_image = function(cpp) {

    prepare_for_new_image();
    restore_pasted_cpp_field();

    var wide = 0, high = 0;

    // Get the split up bytes on all lines
    var lens = [], mostlens = [];
    $.each(cpp.split('\n'), function(i,s) {
      var pw = 0;
      $.each(s.replace(/[ \t]/g,'').split(','), function(i,s) {
        if (s.match(/0x[0-9a-f]+/i) || s.match(/0b[01]+/) || s.match(/B[01]+/) || s.match(/[0-9]+/))
          ++pw;
      });
      lens.push(pw);
      mostlens[pw] = 0;
    });

    // Find the length with the most instances
    var most_so_far = 0;
    mostlens.fill(0);
    $.each(lens, function(i,v){
      if (++mostlens[v] > most_so_far) {
        most_so_far = mostlens[v];
        wide = v * 8;
      }
    });

    if (!wide) return error_message("No bitmap found in pasted text.");

    // Split up lines and iterate
    var bitmap = [], bitstr = '';
    $.each(cpp.split('\n'), function(i,s) {
      s = s.replace(/[ \t]/g,'');
      // Split up bytes and iterate
      var byteline = [], len = 0;
      $.each(s.split(','), function(i,s) {
        var b;
        if (s.match(/0x[0-9a-f]+/i))          // Hex
          b = parseInt(s.substring(2), 16);
        else if (s.match(/0b[01]+/))          // Binary
          b = parseInt(s.substring(2), 2);
        else if (s.match(/B[01]+/))           // Binary
          b = parseInt(s.substring(1), 2);
        else if (s.match(/[0-9]+/))           // Decimal
          b = s * 1;
        else
          return true;                        // Skip this item

        for (var i = 0; i < 8; i++) {
          Array.prototype.push.apply(byteline, b & 0x80 ? pix_on : pix_off);
          b <<= 1;
        }
        len += 8;
      });
      if (len == wide) bitmap.push(byteline);
    });

    high = bitmap.length;
    if (high < 4) return true;

    ctx_sm.canvas.width  = wide;
    ctx_sm.canvas.height = high;

    // Make a shiny new imagedata for the pasted CPP
    var image_data = ctx_sm.createImageData(wide, high);
    for (var i = 0, y = 0; y < high; y++)
      for (var x = 0; x < wide * 4; x++, i++)
        image_data.data[i] = bitmap[y][x];

    ctx_sm.putImageData(image_data, 0, 0);

    data_source = wide + 'x' + high + ' C/C++ data';
    load_url_into_image(cnv_sm.toDataURL('image/png'), wide, high);
    $filein.val('');
  };

  var got_image = function(fileref) {
    data_source = 'paste';
    $invert.prop('checked', 0);
    $filein.val('');
    prepare_for_new_image();
    // if (typeof fileref == 'string')
    //   load_url_into_image(fileref);
    // else
      load_file_into_image(fileref);
  };

  //
  // Handle a paste into the code/image input field.
  // May be C++ code or a pasted image.
  // For a pasted image, call load_file_into_image
  // For pasted code, call load_pasted_cpp_into_image to parse the code into an image.
  //
  var convert_clipboard_to_image = function(e) {
    var clipboardData = e.clipboardData || window.clipboardData,
        items = clipboardData.items,
        found, data;

    // If the browser supports "items" then use it
    if (items) {
      $.each(items, function(){
        switch (this.kind) {
          case 'string':
            found = 'text';
            return false;
          case 'file':
            found = 'image';
            data = this;
            return false;
        }
      });
    }
    else {
      // Try the 'types' array for Safari / Webkit
      $.each(clipboardData.types, function(i,type) {
        if (found) return false;
        if (type == 'image/png') {
          //data = clipboardData.getData(type);
          // console.log('Got ' + (typeof data) + ' for ' + type + ' with length ' + data.length);
          // $('<img/>').attr('src', 'blob:'+clipboardData.types[i-1]);
          found = 'safari';
        }
        else if (type == 'text/plain') {
          found = type;
          data = clipboardData.getData(type);
        }
      });
    }

    switch (found) {
      case 'text/plain':
      case 'text':
        load_pasted_cpp_into_image(clipboardData.getData(found));
        break;
      case 'image':
        got_image(data.getAsFile()); // blob
        break;
      case 'image/png':
        got_image(data);
        break;
      case 'safari':
        error_message("No image paste in this browser.");
        break;
      default: error_message("Couldn't processed pasted " + found + " data!");
    }

  };

  //
  // File Input Change Event
  //
  // If the file input value changes try to read the data from the file.
  // The reader.load() handler will fire on successful load.
  //
  $filein.change(function() {

    prepare_for_new_image();

    var fileref = $filein[0].files[0];
    if (fileref) {
      $invert.prop('checked', 0);
      white_on = false;
      data_source = "the file '" + fileref.name + "'";
      load_file_into_image(fileref);
    }
    else
      error_message("Error opening file.");

    //return false; // No default handler
  });

  // Enable standard form field events
  prepare_for_new_image();

  // Set a friendly message for C++ data paste
  restore_pasted_cpp_field();

  // If the output is clicked, select all
  $output
    .on('mousedown mouseup', function(){ return false; })
    .on('focus click', function(e){ this.select(); return false; });

  // Paste old C++ code to see the image and reformat
  $pasted
    .focus(function() {
      var $this = $(this);
      $this
        .val('')
        .css('color', '#F80')
        .one('blur', restore_pasted_cpp_field)
        .one('paste', function(e) {
          $this.css('color', '#FFFFFF00');
          convert_clipboard_to_image(e);
          $this.trigger('blur');
          return false;
        });
    })
    .keyup(function(){ $(this).val(''); return false; })
    .keydown(function(){ $(this).val(''); });

};

head.ready(bitmap_converter);
