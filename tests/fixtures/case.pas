program CaseDemo;
var n, s, k: integer; c: char;
begin
  readln(n, c);
  case n of
    1: s := 10;
    2, 3: begin s := 20; k := 1; end;
    4..6: writeln(n);
  else
    s := 0;
  end;
  case c of
    'a': k := 1;
    'b': k := 2;
  end;
  case n of
    1: s := 1;
    2: s := 2;
    3: s := 3;
    4: s := 4;
    5: s := 5;
    6: s := 6;
  else s := 7;
  end;
  writeln(s, k);
end.
